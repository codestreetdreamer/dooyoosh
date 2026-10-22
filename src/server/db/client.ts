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

/** Raw postgres-js client (owner role behind DATABASE_URL; bypasses RLS). Server only. */
export function getSql(): postgres.Sql {
  client ??= postgres(serverEnv().DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20 });
  return client;
}

export function getDb(): Db {
  db ??= drizzle(getSql(), { schema });
  return db;
}

export type Tx = postgres.TransactionSql;

/**
 * Public storefront reads: a READ ONLY transaction that drops to the `anon` role, so RLS, column grants
 * (no stock counts) and the security_invoker storefront_* views apply exactly as for a browser anon key.
 */
export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getSql().begin("read only", async (tx) => {
    await tx`set local role anon`;
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    return fn(tx);
  })) as T;
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
