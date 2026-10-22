import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common";
import { productVariants } from "./catalog";
import { checkouts, orders } from "./orders";

export const movementReason = pgEnum("inventory_movement_reason", ["restock", "adjustment", "sale", "cancellation", "return", "damage"]);
export const reservationStatus = pgEnum("stock_reservation_status", ["active", "converted", "released"]);

// Append-only ledger; UPDATE/DELETE revoked in SQL migration.
export const inventoryMovements = pgTable("inventory_movements", {
  id: id(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  delta: integer("delta").notNull(),
  reason: movementReason("reason").notNull(),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
  note: text("note"),
  actorId: uuid("actor_id"),
  createdAt: createdAt(),
}, (t) => [
  check("inventory_movements_delta_nonzero", sql`${t.delta} <> 0`),
  index("inventory_movements_variant_idx").on(t.variantId, t.createdAt),
  index("inventory_movements_order_idx").on(t.orderId),
]);

export const stockReservations = pgTable("stock_reservations", {
  id: id(),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  checkoutId: uuid("checkout_id").notNull().references(() => checkouts.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: reservationStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
}, (t) => [
  check("stock_reservations_qty_pos", sql`${t.quantity} > 0`),
  // QA-09: one reservation row per (checkout, variant); reserve_checkout aggregates duplicate lines
  unique("stock_reservations_checkout_variant_uq").on(t.checkoutId, t.variantId),
  index("stock_reservations_checkout_idx").on(t.checkoutId),
  index("stock_reservations_variant_idx").on(t.variantId),
  index("stock_reservations_active_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'active'`),
]);
