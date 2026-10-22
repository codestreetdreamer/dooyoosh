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
