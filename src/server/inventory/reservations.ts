/**
 * InventoryService (src/contracts/inventory.ts) over the SECURITY DEFINER functions in migration 0002.
 * Owner: Backend & Database. Payments & Orders calls ONLY these wrappers; app code never writes stock columns.
 * Every call runs inside the caller's transaction when `tx` (a Drizzle transaction) is passed.
 */
import "server-only";
import { sql } from "drizzle-orm";
import type {
  AdjustStockInput,
  ConvertOrderInput,
  ConvertResult,
  InventoryService,
  ReleaseReason,
  ReserveLine,
  ReserveResult,
  TxLike,
} from "@/contracts/inventory";
import { ApiError } from "@/lib/errors";
import { asPgAppError, detailIds, getDb, type Db } from "../db/client";

type Exec = Pick<Db, "execute">;
const exec = (tx?: TxLike): Exec => (tx as Exec | undefined) ?? getDb();

function rows<T>(r: unknown): T[] {
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

/** Map DB app errors to ApiError; rethrow anything else. */
export function mapDbError(e: unknown): never {
  const pg = asPgAppError(e);
  if (!pg) throw e;
  switch (pg.message) {
    case "OUT_OF_STOCK":
      throw ApiError.outOfStock(detailIds(pg.detail));
    case "PRICE_CHANGED":
      throw ApiError.priceChanged(detailIds(pg.detail));
    case "NOT_FOUND":
      throw ApiError.notFound();
    case "IDEMPOTENCY_CONFLICT":
      throw ApiError.idempotencyConflict();
    case "VALIDATION_ERROR":
    case "INSUFFICIENT_STOCK":
    case "INVALID_STATE":
    case "AMOUNT_MISMATCH":
      throw new ApiError("VALIDATION_ERROR", pg.message, safeJson(pg.detail));
    default:
      throw e;
  }
}

function safeJson(s: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(s ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { detail: v };
  } catch {
    return {};
  }
}

export interface ConvertOptions {
  /** 'record' (default): late payment -> stock_conflict order (auto-refund). 'abort': nothing written, status 'aborted'. */
  conflictMode?: "record" | "abort";
  /** raw provider payload stored on payments.raw */
  raw?: unknown;
  tx?: TxLike;
}

export const inventory: InventoryService & {
  /** reserve + idempotency payload check (p_payload_hash = hex sha256 of the createCheckout payload). */
  reserveWith(checkoutId: string, lines: ReserveLine[], expiresAt: Date, opts: { payloadHash?: string; tx?: TxLike }): Promise<ReserveResult>;
  convertWith(checkoutId: string, order: ConvertOrderInput, opts: ConvertOptions): Promise<ConvertResult>;
  /** checkout id stored for an idempotencyKey (null if none); throws ApiError IDEMPOTENCY_CONFLICT (409) if the payload hash differs. */
  checkoutIdForIdempotencyKey(key: string, payloadHash: string, tx?: TxLike): Promise<string | null>;
  restockOrder(orderId: string, reason?: "return" | "cancellation", actorId?: string | null, note?: string, tx?: TxLike): Promise<number>;
} = {
  reserve(checkoutId: string, lines: ReserveLine[], expiresAt: Date, tx?: TxLike): Promise<ReserveResult> {
    return this.reserveWith(checkoutId, lines, expiresAt, { tx });
  },

  async reserveWith(checkoutId, lines, expiresAt, opts) {
    const items = JSON.stringify(lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })));
    try {
      await exec(opts.tx).execute(
        sql`select public.reserve_checkout(${checkoutId}::uuid, ${items}::jsonb, ${expiresAt.toISOString()}::timestamptz, ${opts.payloadHash ?? null}::text)`,
      );
      return { ok: true };
    } catch (e) {
      const pg = asPgAppError(e);
      if (pg?.message === "OUT_OF_STOCK" || pg?.message === "PRICE_CHANGED") return { ok: false, code: pg.message, variantIds: detailIds(pg.detail) };
      return mapDbError(e);
    }
  },

  convert(checkoutId: string, order: ConvertOrderInput, opts?: { conflictMode?: "record" | "abort"; tx?: TxLike }): Promise<ConvertResult> {
    return this.convertWith(checkoutId, order, opts ?? {});
  },

  async checkoutIdForIdempotencyKey(key, payloadHash, tx) {
    try {
      const r = rows<{ id: string | null }>(
        await exec(tx).execute(sql`select public.checkout_id_for_idempotency_key(${key}::uuid, ${payloadHash}::text) as id`),
      );
      return r[0]?.id ?? null;
    } catch (e) {
      return mapDbError(e);
    }
  },

  async convertWith(checkoutId, order, opts) {
    const tx = opts.tx;
    const payload = JSON.stringify({
      reference: order.reference,
      provider: order.provider,
      provider_payment_id: order.providerPaymentId,
      amount_minor: order.amountMinor,
      currency: order.currency,
      paid_at: order.paidAt.toISOString(),
      raw: opts.raw ?? null,
    });
    try {
      const r = rows<{ r: { order_id: string; reference: string; status: string; conflict_variant_ids: string[] } }>(
        await exec(tx).execute(
          sql`select public.convert_checkout_to_order(${checkoutId}::uuid, ${payload}::jsonb, ${opts.conflictMode ?? "record"}) as r`,
        ),
      )[0]!.r;
      if (r.status === "aborted") return { status: "aborted", conflictVariantIds: r.conflict_variant_ids ?? [] };
      if (r.status === "paid") return { status: "paid", orderId: r.order_id, reference: r.reference };
      if (r.status === "already_converted") return { status: "already_converted", orderId: r.order_id, reference: r.reference };
      return { status: "stock_conflict", orderId: r.order_id, reference: r.reference, conflictVariantIds: r.conflict_variant_ids };
    } catch (e) {
      return mapDbError(e);
    }
  },

  async release(checkoutId: string, reason: ReleaseReason, tx?: TxLike): Promise<number> {
    try {
      const r = rows<{ n: number }>(
        await exec(tx).execute(sql`select public.release_checkout(${checkoutId}::uuid, ${reason}) as n`),
      );
      return Number(r[0]?.n ?? 0);
    } catch (e) {
      return mapDbError(e);
    }
  },

  async releaseExpired(now: Date = new Date(), limit = 500): Promise<number> {
    const r = rows<{ n: number }>(
      await getDb().execute(sql`select public.release_expired_reservations(${now.toISOString()}::timestamptz, ${limit}::int) as n`),
    );
    return Number(r[0]?.n ?? 0);
  },

  async adjust(input: AdjustStockInput, actorId: string | null): Promise<{ stockOnHand: number }> {
    try {
      const r = rows<{ n: number }>(
        await getDb().execute(
          sql`select public.adjust_stock(${input.variantId}::uuid, ${input.delta}::int, ${input.reason}::public.inventory_movement_reason, ${input.note ?? null}, ${actorId}::uuid) as n`,
        ),
      );
      return { stockOnHand: Number(r[0]?.n ?? 0) };
    } catch (e) {
      return mapDbError(e);
    }
  },

  /** Return path (e.g. Payme CancelTransaction after Perform): puts back what the order's 'sale' movements took. Idempotent. */
  async restockOrder(orderId: string, reason: "return" | "cancellation" = "return", actorId: string | null = null, note?: string, tx?: TxLike) {
    try {
      const r = rows<{ n: number }>(
        await exec(tx).execute(
          sql`select public.restock_order(${orderId}::uuid, ${reason}::public.inventory_movement_reason, ${actorId ?? null}::uuid, ${note ?? null}) as n`,
        ),
      );
      return Number(r[0]?.n ?? 0);
    } catch (e) {
      return mapDbError(e);
    }
  },
};

export const { reserve, convert, release, releaseExpired, adjust, restockOrder } = {
  reserve: inventory.reserve.bind(inventory),
  convert: inventory.convert.bind(inventory),
  release: inventory.release.bind(inventory),
  releaseExpired: inventory.releaseExpired.bind(inventory),
  adjust: inventory.adjust.bind(inventory),
  restockOrder: inventory.restockOrder.bind(inventory),
};
