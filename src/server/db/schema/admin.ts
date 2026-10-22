import { boolean, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";

export const adminRole = pgEnum("admin_role", ["owner", "editor", "fulfilment"]);

// id = auth.users.id (FK added in a hand-written SQL migration, auth schema is Supabase-managed)
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey(),
  role: adminRole("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  diff: jsonb("diff"),
  createdAt: createdAt(),
}, (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_created_idx").on(t.createdAt)]);

// Customer/admin profile; id = auth.users.id (FK in hand-written SQL migration 0001).
// RLS: a user reads/updates only their own row; admins read all.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  fullName: text("full_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
