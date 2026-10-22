/**
 * Re-exports only. Single source of truth for payment types is src/contracts/payments.ts (Architect).
 * Server-only extensions (merchant-callback providers like Payme/Click) live in ./provider.ts.
 */
export * from "@/contracts/payments";
export type { CheckoutSnapshotLine, Totals } from "@/contracts/checkout";
export type { InventoryService, ConvertResult, ConvertOrderInput, ReserveLine, ReleaseReason, TxLike } from "@/contracts/inventory";
