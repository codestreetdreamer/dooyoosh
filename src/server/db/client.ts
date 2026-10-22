/**
 * Postgres connection for server code (owner: Backend & Database). Only `src/server/*` may import this.
 * DATABASE_URL = Supabase pooler URI (transaction mode, port 6543) => prepared statements disabled.
 */
import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    client = postgres(serverEnv().DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20 });
    db = drizzle(client, { schema });
  }
  return db;
}

/** Shape of a Postgres error raised by our SQL functions (RAISE ... USING ERRCODE='P0001'). */
export interface PgAppError {
  code: string;
  message: string;
  detail?: string;
}

export function asPgAppError(e: unknown): PgAppError | null {
  const err = (e as { cause?: unknown })?.cause ?? e;
  if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "P0001") {
    const x = err as { code: string; message: string; detail?: string };
    return { code: x.code, message: x.message, detail: x.detail };
  }
  return null;
}

/** DETAIL of OUT_OF_STOCK / PRICE_CHANGED / STOCK_CONFLICT is a JSON array of variant ids. */
export function detailIds(detail: string | undefined): string[] {
  try {
    const v: unknown = JSON.parse(detail ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
