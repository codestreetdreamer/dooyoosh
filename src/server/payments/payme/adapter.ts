/**
 * PaymeAdapter: Payme Business Merchant API (JSON-RPC 2.0, Payme calls us). Owner: Payments & Orders.
 * Method semantics follow https://developer.help.paycom.uz/metody-merchant-api/ (CheckPerformTransaction,
 * CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction, GetStatement) and the sandbox scenarios
 * at https://developer.help.paycom.uz/pesochnitsa ("repeated Create/Perform/Cancel must return the same answer").
 *
 * Our mapping (one-time account, "одноразовый счёт"):
 *  - account[PAYME_ACCOUNT_FIELD] = our checkout id; amount in tiyin must equal checkouts.total_cents, currency UZS.
 *  - Stock is reserved by OUR checkout before redirect (35 min). Check/Create only verify the reservation is active.
 *  - Perform converts the reservation into an order (convert_checkout_to_order). If the reservation expired first,
 *    Perform returns -31008, marks the txn cancelled (reason 3) and NO order is created.
 *  - Cancel on state 1 releases the reservation; Cancel on state 2 (after Perform) = refund: order -> refunded and
 *    every line restocked with inventory_movements reason 'return'. Shipped/delivered orders -> -31007.
 *  - Every answer is HTTP 200 (non-200 = -32400 for Payme, protokol-merchant-api).
 */
import type { CheckoutForPayment, CreateSessionResult, PaymentMode, PaymentProvider, RefundInput, RefundResult, VerifiedWebhook, WebhookRequestMeta } from "../types";
import type { PaymentConfig } from "../config";
import type { PaymentDeps } from "../deps";
import type { CheckoutRow, ProviderTxn } from "../store";
import { captureCheckout, refundAfterProviderCancel } from "../settlement";
import { isDemoIkpu } from "../../checkout/pricing";
import { MSG, PAYME_CHECKOUT_HOST, PAYME_ERRORS as E, PAYME_IPS, PAYME_REASON, PAYME_TIMEOUT_MS, PaymeRpcError, buildPaymeCheckoutUrl, verifyPaymeAuth } from "./protocol";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Params = Record<string, unknown>;

export class PaymeAdapter implements PaymentProvider {
  readonly name = "payme" as const;
  /** Merchant API amounts are tiyin of UZS (tipy-dannykh: Amount). */
  readonly supportedCurrencies = ["UZS"] as const;

  constructor(
    readonly mode: PaymentMode,
    private readonly cfg: NonNullable<PaymentConfig["payme"]>,
    private readonly deps: PaymentDeps,
  ) {}

  async createSession(c: CheckoutForPayment): Promise<CreateSessionResult> {
    const redirectUrl = buildPaymeCheckoutUrl({
      host: PAYME_CHECKOUT_HOST[this.mode],
      merchantId: this.cfg.merchantId,
      accountField: this.cfg.accountField,
      checkoutId: c.checkoutId,
      amountTiyin: c.totals.totalMinor,
      lang: c.locale,
      returnUrl: c.successUrl,
    });
    // No session object exists at Payme before CreateTransaction; our checkout id is the session key.
    return { redirectUrl, providerSessionId: `payme:${c.checkoutId}`, expiresAt: c.expiresAt };
  }

  /** Payme has no merchant API to cancel an open cheque; it times out after 12 h and our Perform refuses expired reservations. */
  async cancel(): Promise<void> {}

  /** Refunds are done by staff in the Payme Business cabinet, which then calls our CancelTransaction (canceltransaction docs). */
  async refund(input: RefundInput): Promise<RefundResult> {
    return { status: "manual_required", instructions: `Refund Payme transaction ${input.providerPaymentId} (${input.amountMinor} tiyin) in the Payme Business cabinet; Payme will call CancelTransaction.` };
  }

  async verifyWebhook(rawBody: string, headers: Headers, meta?: WebhookRequestMeta): Promise<VerifiedWebhook> {
    const body = await this.handleRpc(rawBody, headers, meta);
    const text = JSON.stringify(body);
    return { events: [], respond: () => ({ status: 200, body: text, headers: { "content-type": "application/json; charset=UTF-8" } }) };
  }

  /** Full JSON-RPC handling; exported for tests. Never throws. */
  async handleRpc(rawBody: string, headers: Headers, meta?: WebhookRequestMeta): Promise<{ result?: unknown; error?: unknown; id: unknown }> {
    let id: unknown = null;
    let req: { method?: unknown; params?: unknown; id?: unknown } | undefined;
    try {
      req = JSON.parse(rawBody);
      id = req && typeof req === "object" ? (req.id ?? null) : null;
    } catch {
      req = undefined;
    }
    const err = (e: PaymeRpcError) => ({ error: { code: e.code, message: e.localized, ...(e.data !== undefined ? { data: e.data } : {}) }, id });
    try {
      if (meta && meta.method !== "POST") throw new PaymeRpcError(E.NOT_POST, MSG.notPost);
      if (this.cfg.enforceIp && (!meta?.ip || !PAYME_IPS.includes(meta.ip))) throw new PaymeRpcError(E.UNAUTHORIZED, MSG.unauthorized);
      if (!verifyPaymeAuth(headers.get("authorization"), this.cfg.key, this.cfg.login)) throw new PaymeRpcError(E.UNAUTHORIZED, MSG.unauthorized);
      if (!req) throw new PaymeRpcError(E.PARSE, MSG.parse);
      if (typeof req.method !== "string" || typeof req.params !== "object" || req.params === null) throw new PaymeRpcError(E.INVALID_REQUEST, MSG.badRequest);
      const params = req.params as Params;
      switch (req.method) {
        case "CheckPerformTransaction": return { result: await this.checkPerform(params), id };
        case "CreateTransaction": return { result: await this.create(params), id };
        case "PerformTransaction": return { result: await this.perform(params), id };
        case "CancelTransaction": return { result: await this.cancelTxn(params), id };
        case "CheckTransaction": return { result: await this.check(params), id };
        case "GetStatement": return { result: await this.statement(params), id };
        default: throw new PaymeRpcError(E.METHOD_NOT_FOUND, MSG.method, req.method);
      }
    } catch (e) {
      if (e instanceof PaymeRpcError) return err(e);
      console.error("[payme] system error", e);
      return err(new PaymeRpcError(E.SYSTEM, MSG.system));
    }
  }

  // ---------------- helpers
  private now() { return this.deps.now(); }
  private int(p: Params, k: string): number {
    const v = p[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new PaymeRpcError(E.INVALID_REQUEST, MSG.badRequest, k);
    return v;
  }
  private str(p: Params, k: string): string {
    const v = p[k];
    if (typeof v !== "string" || v.length === 0 || v.length > 64) throw new PaymeRpcError(E.INVALID_REQUEST, MSG.badRequest, k);
    return v;
  }

  /** account -> checkout, amount -> total, reservation still active. Errors per CheckPerformTransaction docs. */
  private async validateOrder(p: Params): Promise<CheckoutRow> {
    const amount = this.int(p, "amount");
    const account = p.account;
    if (typeof account !== "object" || account === null) throw new PaymeRpcError(E.INVALID_REQUEST, MSG.badRequest, "account");
    const field = this.cfg.accountField;
    const checkoutId = (account as Params)[field];
    if (typeof checkoutId !== "string" || !UUID.test(checkoutId)) throw new PaymeRpcError(E.ACCOUNT_NOT_FOUND, MSG.orderNotFound, field);
    const c = await this.deps.repo.getCheckout(checkoutId);
    if (!c || c.provider !== "payme") throw new PaymeRpcError(E.ACCOUNT_NOT_FOUND, MSG.orderNotFound, field);
    if (amount !== c.totalMinor || c.currency !== "UZS") throw new PaymeRpcError(E.INVALID_AMOUNT, MSG.amount);
    if (c.status !== "open" && c.status !== "awaiting_payment") throw new PaymeRpcError(E.ACCOUNT_NOT_PAYABLE, MSG.orderNotPayable, field);
    if (!(await this.deps.repo.isReservationActive(c.id, this.now()))) throw new PaymeRpcError(E.ACCOUNT_NOT_PAYABLE, MSG.orderNotPayable, field);
    return c;
  }

  private txnView(t: ProviderTxn) {
    return { create_time: t.createTime, perform_time: t.performTime, cancel_time: t.cancelTime, transaction: String(t.seq), state: t.state, reason: t.reason };
  }

  private async getTxn(p: Params): Promise<ProviderTxn> {
    const t = await this.deps.repo.getProviderTxn("payme", this.str(p, "id"));
    if (!t) throw new PaymeRpcError(E.TXN_NOT_FOUND, MSG.notFound);
    return t;
  }

  /** state 1 older than 12 h (from Payme's own `time`) -> cancel with reason 4 and release stock. */
  private async expireIfTimedOut(t: ProviderTxn): Promise<boolean> {
    if (t.state !== 1 || this.now().getTime() - t.providerTime <= PAYME_TIMEOUT_MS) return false;
    const u = await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 1, { state: -1, reason: PAYME_REASON.TIMEOUT, cancelTime: this.now().getTime() });
    if (u) await this.releaseCheckout(t.checkoutId, "expired");
    return true;
  }

  private async releaseCheckout(checkoutId: string, status: "expired" | "failed") {
    if (await this.deps.repo.getOrderByCheckout(checkoutId)) return;
    await this.deps.inventory.release(checkoutId, status === "expired" ? "expired" : "canceled");
    await this.deps.repo.setCheckoutStatus(checkoutId, status);
  }

  /** Fiscal receipt detail for CheckPerformTransaction (checkperformtransaction docs, "Добавление объекта detail"). */
  private fiscalDetail(c: CheckoutRow) {
    if (c.items.some((l) => !l.ikpuCode || !l.packageCode || !Number.isInteger(l.vatRateBp))) return undefined;
    // DEMO- IKPU codes must never produce a live fiscal receipt (Backend rule); in live mode refuse the payment.
    if (c.items.some((l) => isDemoIkpu(l.ikpuCode))) {
      if (this.mode === "live") throw new PaymeRpcError(E.ACCOUNT_NOT_PAYABLE, MSG.orderNotPayable, this.cfg.accountField);
      return undefined;
    }
    return {
      receipt_type: 0,
      ...(c.shippingMinor > 0 ? { shipping: { title: c.shippingName, price: c.shippingMinor } } : {}),
      items: c.items.map((l) => ({
        title: [l.productName, l.size, l.colour].filter(Boolean).join(" ").slice(0, 120),
        price: l.unitPriceMinor,
        count: l.quantity,
        code: l.ikpuCode,
        package_code: l.packageCode,
        vat_percent: l.vatRateBp / 100,
      })),
    };
  }

  // ---------------- methods
  private async checkPerform(p: Params) {
    const c = await this.validateOrder(p);
    const detail = this.fiscalDetail(c);
    return detail ? { allow: true, detail } : { allow: true };
  }

  private async create(p: Params) {
    const id = this.str(p, "id");
    const time = this.int(p, "time");
    const existing = await this.deps.repo.getProviderTxn("payme", id);
    if (existing) {
      if (existing.state !== 1) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
      if (await this.expireIfTimedOut(existing)) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
      return { create_time: existing.createTime, transaction: String(existing.seq), state: existing.state };
    }
    const c = await this.validateOrder(p);
    // one-time account: a second transaction for the same order while one is open -> -31008 (pesochnitsa scenario)
    if ((await this.deps.repo.findOpenProviderTxns("payme", c.id)).length > 0) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
    await this.deps.repo.recordPaymentEvent("payme", `CreateTransaction:${id}`, "CreateTransaction", p);
    const { txn } = await this.deps.repo.insertProviderTxn({
      provider: "payme", providerTxnId: id, checkoutId: c.id, amountMinor: c.totalMinor, currency: c.currency,
      state: 1, reason: null, providerTime: time, createTime: this.now().getTime(), performTime: 0, cancelTime: 0, orderId: null, raw: { account: p.account },
    });
    if (txn.providerTxnId !== id || txn.state !== 1) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
    await this.deps.repo.markPaymentEventProcessed("payme", `CreateTransaction:${id}`, null);
    return { create_time: txn.createTime, transaction: String(txn.seq), state: txn.state };
  }

  private async perform(p: Params) {
    const t = await this.getTxn(p);
    if (t.state === 2) return { transaction: String(t.seq), perform_time: t.performTime, state: 2 };
    if (t.state !== 1) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
    if (await this.expireIfTimedOut(t)) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);

    const now = this.now();
    // Read reservation FIRST, then order: convert flips both atomically, so a concurrent winner is always seen
    // as "order exists" here (reading in the other order lets a retry cancel a txn that was just paid).
    const reservationActive = await this.deps.repo.isReservationActive(t.checkoutId, now);
    if (!reservationActive && !(await this.deps.repo.getOrderByCheckout(t.checkoutId))) {
      // reservation expired (35 min) before Payme finished: refuse, no order, stock already back on sale
      const u = await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 1, { state: -1, reason: PAYME_REASON.EXECUTION_ERROR, cancelTime: now.getTime() });
      if (u) await this.releaseCheckout(t.checkoutId, "expired");
      throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.orderNotPayable);
    }

    const eventId = `PerformTransaction:${t.providerTxnId}`;
    await this.deps.repo.recordPaymentEvent("payme", eventId, "PerformTransaction", p);
    const r = await captureCheckout(this.deps, { provider: "payme", checkoutId: t.checkoutId, providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, eventId, raw: { method: "PerformTransaction", id: t.providerTxnId } });
    if (r.kind === "not_found") throw new PaymeRpcError(E.TXN_NOT_FOUND, MSG.notFound);
    if (r.kind === "stock_conflict") {
      // lost a race with expiry between our check and convert: order is stock_conflict, refuse so Payme does not finalize.
      await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 1, { state: -1, reason: PAYME_REASON.EXECUTION_ERROR, cancelTime: now.getTime(), orderId: r.orderId });
      // we refuse Perform, so Payme does not take the money: payment row is canceled, not succeeded
      await this.deps.repo.upsertPayment({ orderId: r.orderId, provider: "payme", providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, status: "canceled", raw: { refusedAtPerform: true } });
      await this.deps.repo.markPaymentEventProcessed("payme", eventId, "stock_conflict");
      throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.orderNotPayable);
    }
    const updated = await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 1, { state: 2, performTime: now.getTime(), orderId: r.orderId });
    const final = updated ?? (await this.deps.repo.getProviderTxn("payme", t.providerTxnId))!;
    await this.deps.repo.markPaymentEventProcessed("payme", eventId, null);
    if (final.state !== 2) throw new PaymeRpcError(E.CANNOT_PERFORM, MSG.cannotPerform);
    return { transaction: String(final.seq), perform_time: final.performTime, state: 2 };
  }

  private async cancelTxn(p: Params) {
    const t = await this.getTxn(p);
    const reason = typeof p.reason === "number" ? p.reason : PAYME_REASON.UNKNOWN;
    const now = this.now().getTime();
    const view = (x: ProviderTxn) => ({ transaction: String(x.seq), cancel_time: x.cancelTime, state: x.state });
    if (t.state === -1 || t.state === -2) return view(t);
    if (t.state === 1) {
      const u = await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 1, { state: -1, reason, cancelTime: now });
      if (u) await this.releaseCheckout(t.checkoutId, "failed");
      return view(u ?? (await this.deps.repo.getProviderTxn("payme", t.providerTxnId))!);
    }
    // state 2: cancel after perform = refund
    const order = t.orderId ? await this.deps.repo.getOrder(t.orderId) : null;
    if (order && (order.status === "shipped" || order.status === "delivered")) throw new PaymeRpcError(E.CANNOT_CANCEL, MSG.cannotCancel);
    const eventId = `CancelTransaction:${t.providerTxnId}`;
    await this.deps.repo.recordPaymentEvent("payme", eventId, "CancelTransaction", p);
    const u = await this.deps.repo.updateProviderTxn("payme", t.providerTxnId, 2, { state: -2, reason, cancelTime: now });
    if (u && t.orderId) {
      await refundAfterProviderCancel(this.deps, { provider: "payme", orderId: t.orderId, providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, eventId, reason: `payme_cancel_reason_${reason}` });
    }
    await this.deps.repo.markPaymentEventProcessed("payme", eventId, null);
    return view(u ?? (await this.deps.repo.getProviderTxn("payme", t.providerTxnId))!);
  }

  private async check(p: Params) {
    return this.txnView(await this.getTxn(p));
  }

  private async statement(p: Params) {
    const from = this.int(p, "from");
    const to = this.int(p, "to");
    const list = await this.deps.repo.listProviderTxns("payme", from, to);
    return {
      transactions: list.map((t) => ({
        id: t.providerTxnId, time: t.providerTime, amount: t.amountMinor, account: { [this.cfg.accountField]: t.checkoutId },
        create_time: t.createTime, perform_time: t.performTime, cancel_time: t.cancelTime, transaction: String(t.seq), state: t.state, reason: t.reason,
      })),
    };
  }
}
