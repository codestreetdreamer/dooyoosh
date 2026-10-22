/** Dependencies injected into checkout/payment services and adapters (no globals => testable). */
import type { InventoryService } from "./types";
import type { CommerceRepo } from "./store";
import type { PaymentConfig } from "./config";
import type { OrderNotifier } from "../email/notifier";

export interface PaymentDeps {
  repo: CommerceRepo;
  inventory: InventoryService;
  notifier: OrderNotifier;
  config: PaymentConfig;
  now: () => Date;
}

/**
 * adjust_stock(p_actor_id uuid) needs an actor. Automatic restocks (provider cancel-after-perform) use this nil UUID.
 * PROPOSAL to Backend: accept NULL actor for system movements instead.
 */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
