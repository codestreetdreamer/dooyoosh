/**
 * ClickAdapter: Click SHOP API (Prepare action=0, Complete action=1). Owner: Payments & Orders.
 * See ./protocol.ts for the doc sources. Our mapping:
 *  - merchant_trans_id = our checkout id; amount (soums) must equal checkouts.total_cents (tiyin) of a UZS checkout.
 *  - Prepare only verifies (order exists, amount, reservation active) and records the txn; stock was reserved by our
 *    checkout before redirect. merchant_prepare_id = provider_transactions.seq.
 *  - Complete with error < 0 (Click reports a failed debit) -> cancel txn, release reservation, answer -9.
 *  - Complete with error = 0 -> convert reservation into an order; reservation expired -> -9 and NO order.
 *  - Repeated Complete for a completed payment -> -4 "Already paid" (docs: the only errors allowed after debit are -4/-9).
 *  - Complete with error < 0 after we completed (Postman scenario 8) -> refund path (order refunded, restock 'return'), -9.
 */
import type { CheckoutForPayment, CreateSessionResult, PaymentMode, PaymentProvider, RefundInput, RefundResult, VerifiedWebhook } from "../types";
import type { PaymentConfig } from "../config";
import type { PaymentDeps } from "../deps";
import type { ProviderTxn } from "../store";
import { captureCheckout, refundAfterProviderCancel } from "../settlement";
import { CLICK_ERRORS as E, CLICK_PAY_URL, clickAmountToMinor, minorToClickAmount, parseClickBody, verifyClickSign, type ClickRequest } from "./protocol";

type Err = (typeof E)[keyof typeof E];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hook for fiscal receipts (Click OFD submit_items API, docs.click.uz/merchant-api/fiscalization). Not called in sandbox. */
export interface ClickFiscalHook {
  submitItems(input: { serviceId: string; paymentId: string; orderId: string }): Promise<void>;
}

export class ClickAdapter implements PaymentProvider {
  readonly name = "click" as const;
  readonly supportedCurrencies = ["UZS"] as const;
  fiscalHook: ClickFiscalHook | null = null;

  constructor(
    readonly mode: PaymentMode,
    private readonly cfg: NonNullable<PaymentConfig["click"]>,
    private readonly deps: PaymentDeps,
  ) {}

  async createSession(c: CheckoutForPayment): Promise<CreateSessionResult> {
    let redirectUrl: string;
    if (this.mode === "live") {
      const u = new URL(CLICK_PAY_URL);
      u.searchParams.set("service_id", this.cfg.serviceId);
      u.searchParams.set("merchant_id", this.cfg.merchantId);
      u.searchParams.set("amount", minorToClickAmount(c.totals.totalMinor, c.totals.currency));
      u.searchParams.set("transaction_param", c.checkoutId);
      u.searchParams.set("return_url", c.successUrl);
      redirectUrl = u.toString();
    } else {
      // Click has no separate sandbox host: never send sandbox customers to the real my.click.uz page.
      const u = new URL(`/${c.locale}/checkout/sandbox-pay`, this.deps.config.siteUrl);
      u.searchParams.set("checkoutId", c.checkoutId);
      u.searchParams.set("provider", "click");
      redirectUrl = u.toString();
    }
    return { redirectUrl, providerSessionId: `click:${c.checkoutId}`, expiresAt: c.expiresAt };
  }

  async cancel(): Promise<void> {}

  async refund(input: RefundInput): Promise<RefundResult> {
    // Click merchant API has payment reversal (docs.click.uz/merchant-api/requests), not implemented in sandbox phase.
    return { status: "manual_required", instructions: `Reverse Click payment ${input.providerPaymentId} (${input.amountMinor} tiyin) in the Click merchant cabinet.` };
  }

  async verifyWebhook(rawBody: string): Promise<VerifiedWebhook> {
    const body = await this.handle(rawBody);
    const text = JSON.stringify(body);
    return { events: [], respond: () => ({ status: 200, body: text, headers: { "content-type": "application/json" } }) };
  }

  /** Prepare/Complete handling; exported for tests. Never throws. */
  async handle(rawBody: string): Promise<Record<string, unknown>> {
    const r = parseClickBody(rawBody);
    if (!r) return { ...E.BAD_REQUEST };
    const base = { click_trans_id: r.click_trans_id, merchant_trans_id: r.merchant_trans_id };
    const fail = (e: Err) => ({ ...base, ...e });
    try {
      if (!verifyClickSign(r, this.cfg.secretKey)) return fail(E.SIGN_FAILED);
      if (r.service_id !== this.cfg.serviceId) return fail(E.BAD_REQUEST);
      if (r.action === "0") return await this.prepare(r, base, fail);
      if (r.action === "1") return await this.complete(r, base, fail);
      return fail(E.ACTION_NOT_FOUND);
    } catch (e) {
      console.error("[click] error", e);
      return fail(E.UPDATE_FAILED);
    }
  }

  private async prepare(r: ClickRequest, base: Record<string, string>, fail: (e: Err) => Record<string, unknown>) {
    const { repo } = this.deps;
    if (!UUID.test(r.merchant_trans_id)) return fail(E.USER_NOT_FOUND);
    const c = await repo.getCheckout(r.merchant_trans_id);
    if (!c || c.provider !== "click") return fail(E.USER_NOT_FOUND);
    const amount = clickAmountToMinor(r.amount, c.currency);
    if (amount === null || amount !== c.totalMinor || c.currency !== "UZS") return fail(E.BAD_AMOUNT);

    const existing = await repo.getProviderTxn("click", r.click_trans_id);
    if (existing) {
      if (existing.checkoutId !== c.id) return fail(E.TXN_NOT_FOUND);
      if (existing.state === 2) return fail(E.ALREADY_PAID);
      if (existing.state < 0) return fail(E.CANCELLED);
      return { ...base, merchant_prepare_id: existing.seq, ...E.SUCCESS };
    }
    if ((await repo.getOrderByCheckout(c.id)) || c.status === "completed") return fail(E.ALREADY_PAID);
    if (c.status !== "open" && c.status !== "awaiting_payment") return fail(E.CANCELLED);
    if (!(await repo.isReservationActive(c.id, this.deps.now()))) return fail(E.CANCELLED);

    await repo.recordPaymentEvent("click", `prepare:${r.click_trans_id}`, "prepare", r);
    const { txn } = await repo.insertProviderTxn({
      provider: "click", providerTxnId: r.click_trans_id, checkoutId: c.id, amountMinor: amount, currency: c.currency, state: 1, reason: null,
      providerTime: this.deps.now().getTime(), createTime: this.deps.now().getTime(), performTime: 0, cancelTime: 0, orderId: null,
      raw: { click_paydoc_id: r.click_paydoc_id, sign_time: r.sign_time },
    });
    await repo.markPaymentEventProcessed("click", `prepare:${r.click_trans_id}`, null);
    return { ...base, merchant_prepare_id: txn.seq, ...E.SUCCESS };
  }

  private async complete(r: ClickRequest, base: Record<string, string>, fail: (e: Err) => Record<string, unknown>) {
    const { repo } = this.deps;
    const seq = Number(r.merchant_prepare_id);
    const t = Number.isSafeInteger(seq) ? await repo.getProviderTxnBySeq("click", seq) : null;
    if (!t || t.providerTxnId !== r.click_trans_id || t.checkoutId !== r.merchant_trans_id) return fail(E.TXN_NOT_FOUND);
    const amount = clickAmountToMinor(r.amount, t.currency);
    if (amount === null || amount !== t.amountMinor) return fail(E.BAD_AMOUNT);
    const now = this.deps.now();
    const eventId = `complete:${r.click_trans_id}:${Number(r.error) < 0 ? "cancel" : "ok"}`;
    await repo.recordPaymentEvent("click", eventId, "complete", r);
    const done = async (res: Record<string, unknown>, err: string | null = null) => {
      await repo.markPaymentEventProcessed("click", eventId, err);
      return res;
    };

    if (Number(r.error) < 0) {
      // Click reports the debit failed / was reversed.
      if (t.state === 1) {
        const u = await repo.updateProviderTxn("click", t.providerTxnId, 1, { state: -1, cancelTime: now.getTime(), reason: Number(r.error) });
        if (u) await this.release(t);
      } else if (t.state === 2) {
        const u = await repo.updateProviderTxn("click", t.providerTxnId, 2, { state: -2, cancelTime: now.getTime(), reason: Number(r.error) });
        if (u && t.orderId) await refundAfterProviderCancel(this.deps, { provider: "click", orderId: t.orderId, providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, eventId, reason: `click_error_${r.error}` });
      }
      return done(fail(E.CANCELLED));
    }

    if (t.state === 2) return done(fail(E.ALREADY_PAID));
    if (t.state < 0) return done(fail(E.CANCELLED));
    const others = (await repo.findOpenProviderTxns("click", t.checkoutId)).filter((x) => x.providerTxnId !== t.providerTxnId && x.state === 2);
    if (others.length) return done(fail(E.ALREADY_PAID), "other_txn_completed");

    // Read reservation FIRST, then order: convert flips both atomically, so a concurrent winner is always seen
    // as "order exists" here (reading in the other order lets a retry cancel a txn that was just paid).
    const reservationActive = await repo.isReservationActive(t.checkoutId, now);
    if (!reservationActive && !(await repo.getOrderByCheckout(t.checkoutId))) {
      const u = await repo.updateProviderTxn("click", t.providerTxnId, 1, { state: -1, cancelTime: now.getTime(), reason: null });
      if (u) await this.release(t);
      return done(fail(E.CANCELLED), "reservation_expired");
    }
    const cap = await captureCheckout(this.deps, { provider: "click", checkoutId: t.checkoutId, providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, eventId, raw: { click_paydoc_id: r.click_paydoc_id } }, { conflictMode: "abort" });
    if (cap.kind === "not_found") return done(fail(E.USER_NOT_FOUND), "not_found");
    if (cap.kind === "aborted") {
      // reservation expired between our check and convert: no order written, refuse the Complete
      const u = await repo.updateProviderTxn("click", t.providerTxnId, 1, { state: -1, cancelTime: now.getTime(), reason: null });
      if (u) await this.release(t);
      return done(fail(E.CANCELLED), "aborted");
    }
    if (cap.kind === "stock_conflict") {
      await repo.updateProviderTxn("click", t.providerTxnId, 1, { state: -1, cancelTime: now.getTime(), orderId: cap.orderId });
      await repo.upsertPayment({ orderId: cap.orderId, provider: "click", providerPaymentId: t.providerTxnId, amountMinor: t.amountMinor, currency: t.currency, status: "canceled", raw: { refusedAtComplete: true } });
      return done(fail(E.CANCELLED), "stock_conflict");
    }
    const u = await repo.updateProviderTxn("click", t.providerTxnId, 1, { state: 2, performTime: now.getTime(), orderId: cap.orderId });
    const final: ProviderTxn = u ?? (await repo.getProviderTxn("click", t.providerTxnId))!;
    if (final.state !== 2) return done(fail(E.CANCELLED), "state_changed");
    if (this.fiscalHook && this.mode === "live") await this.fiscalHook.submitItems({ serviceId: this.cfg.serviceId, paymentId: r.click_paydoc_id, orderId: cap.orderId });
    return done({ ...base, merchant_confirm_id: final.seq, ...E.SUCCESS });
  }

  private async release(t: ProviderTxn) {
    if (await this.deps.repo.getOrderByCheckout(t.checkoutId)) return;
    await this.deps.inventory.release(t.checkoutId, "canceled");
    await this.deps.repo.setCheckoutStatus(t.checkoutId, "failed");
  }
}
