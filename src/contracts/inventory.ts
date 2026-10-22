/**
 * Inventory boundary (spec §4, §12.5). Stock changes ONLY via SECURITY DEFINER Postgres functions
 * (EXECUTE granted to service_role only, `SET search_path = ''`). App code never UPDATEs stock columns.
 *
 * DB functions (Backend & Database, migration 0001+):
 *   public.reserve_checkout(p_checkout_id uuid, p_items jsonb, p_expires_at timestamptz) returns void
 *       -- p_items = [{"variant_id": uuid, "quantity": int}], one transaction, ordered by variant_id to avoid deadlocks.
 *       -- raises SQLSTATE 'P0001' with message 'OUT_OF_STOCK' and DETAIL = json array of variant ids.
 *   public.convert_checkout_to_order(p_checkout_id uuid, p_order jsonb) returns jsonb
 *       -- {"order_id", "reference", "status": "paid"|"stock_conflict", "conflict_variant_ids": [...]}
 *       -- non-active/expired reservations -> stock_conflict (no CHECK violation; webhook still returns 200).
 *   public.release_checkout(p_checkout_id uuid, p_reason text) returns int        -- rows released
 *   public.release_expired_reservations(p_now timestamptz default now(), p_limit int default 500) returns int
 *   public.adjust_stock(p_variant_id uuid, p_delta int, p_reason inventory_movement_reason,
 *                       p_note text, p_actor_id uuid) returns int                  -- new stock_on_hand
 *
 * TS wrappers live in src/server/inventory/reservations.ts (owner: Backend & Database) and MUST
 * implement `InventoryService` below. Payments & Orders calls only these wrappers.
 */
import { z } from "zod";
import { uuid, type PaymentProviderName } from "./common";

export const MOVEMENT_REASONS = ["restock", "adjustment", "sale", "cancellation", "return", "damage"] as const;
export const movementReason = z.enum(MOVEMENT_REASONS);
export type MovementReason = z.infer<typeof movementReason>;

export const RESERVATION_STATUSES = ["active", "converted", "released"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RELEASE_REASONS = ["expired", "payment_failed", "canceled"] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export const DB_FUNCTIONS = {
  reserve: "reserve_checkout",
  convert: "convert_checkout_to_order",
  release: "release_checkout",
  releaseExpired: "release_expired_reservations",
  adjust: "adjust_stock",
  restockOrder: "restock_order",
} as const;

export interface ReserveLine {
  variantId: string;
  quantity: number;
}

/** OUT_OF_STOCK and PRICE_CHANGED both map to 409 with details.variantIds (spec §11). */
export type ReserveResult =
  | { ok: true }
  | { ok: false; code: "OUT_OF_STOCK" | "PRICE_CHANGED"; variantIds: string[] };

/** Data the convert function needs to insert orders + order_items (amounts in minor units). */
export interface ConvertOrderInput {
  reference: string;
  provider: PaymentProviderName;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  paidAt: Date;
}

export type ConvertResult =
  | { status: "paid"; orderId: string; reference: string }
  | { status: "stock_conflict"; orderId: string; reference: string; conflictVariantIds: string[] }
  | { status: "already_converted"; orderId: string; reference: string }
  | { status: "aborted"; conflictVariantIds: string[] };

/** A DB transaction handle; concrete type is Drizzle's, kept opaque at the boundary. */
export type TxLike = unknown;

export interface InventoryService {
  reserve(checkoutId: string, lines: ReserveLine[], expiresAt: Date, tx?: TxLike): Promise<ReserveResult>;
  /** conflictMode "record" (default): non-active reservation -> stock_conflict order + auto-refund.
   *  "abort": no order is written, returns { status: "aborted" } (Payme/Click Perform after expiry -> provider error). */
  convert(checkoutId: string, order: ConvertOrderInput, opts?: { conflictMode?: "record" | "abort"; tx?: TxLike }): Promise<ConvertResult>;
  release(checkoutId: string, reason: ReleaseReason, tx?: TxLike): Promise<number>;
  releaseExpired(now?: Date, limit?: number): Promise<number>;
  adjust(input: AdjustStockInput, actorId: string | null): Promise<{ stockOnHand: number }>;
  /** Puts an order's items back on hand (refund / cancel-after-perform). Idempotent per order. Returns rows restocked. */
  restockOrder(orderId: string, reason?: "return" | "cancellation", actorId?: string | null, note?: string): Promise<number>;
}

// ---- Admin: POST /admin/variants/{id}/adjust, GET /admin/variants/{id}/movements ----
export const adjustStockRequest = z.object({
  delta: z.number().int().refine((v) => v !== 0, "delta must be non-zero").refine((v) => Math.abs(v) <= 10_000),
  reason: z.enum(["restock", "adjustment", "return", "damage"]),
  note: z.string().max(500).optional(),
});
export type AdjustStockRequest = z.infer<typeof adjustStockRequest>;
export type AdjustStockInput = AdjustStockRequest & { variantId: string };

export const adjustStockResponse = z.object({
  data: z.object({ variantId: uuid, stockOnHand: z.number().int().nonnegative(), stockReserved: z.number().int().nonnegative() }),
});

export const inventoryMovement = z.object({
  id: uuid,
  variantId: uuid,
  delta: z.number().int(),
  reason: movementReason,
  orderId: uuid.nullable(),
  note: z.string().nullable(),
  actorId: uuid.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type InventoryMovement = z.infer<typeof inventoryMovement>;

// ---- Cron: POST /api/v1/cron/release-expired (Authorization: Bearer CRON_SECRET). Owner: Payments & Orders ----
// Order: for each expired checkout -> PaymentProvider.cancel(session) -> release_checkout(...).
export const releaseExpiredResponse = z.object({
  data: z.object({ checkoutsExpired: z.number().int().nonnegative(), reservationsReleased: z.number().int().nonnegative() }),
});
export type ReleaseExpiredResponse = z.infer<typeof releaseExpiredResponse>;
