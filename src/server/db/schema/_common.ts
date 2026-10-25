import { sql, type SQL } from "drizzle-orm";
import { type AnyPgColumn, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Keep in sync with SUPPORTED_LOCALES in src/contracts/common.ts (SCHEMA_DELTA B6). */
export const LOCALES_SQL = sql.raw("('en','uz','ru')");
export const localeCheck = (c: AnyPgColumn): SQL => sql`${c} IN ${LOCALES_SQL}`;
/** ISO 4217 upper-case (B4). */
export const currencyCheck = (c: AnyPgColumn): SQL => sql`${c} ~ '^[A-Z]{3}$'`;
