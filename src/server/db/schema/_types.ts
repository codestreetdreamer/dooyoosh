import { customType } from "drizzle-orm/pg-core";

/** Postgres tsvector (read-only generated columns for full-text search). */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
