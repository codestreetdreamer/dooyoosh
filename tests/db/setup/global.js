// Starts a throwaway local Postgres 17 (same major as Supabase project), applies
// src/server/db/migrations/*.sql in order, and adds Supabase-like roles (anon,
// authenticated, service_role) so RLS can be probed. Never touches the real Supabase project.
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const PORT = 54329;
const MIGRATIONS = path.resolve(import.meta.dirname, "../../../src/server/db/migrations");

let server;
export async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dooyoosh-qa-pg-"));
  // Private throwaway cluster owned by this user (does NOT touch any system cluster)
  const BIN = process.env.PG_BIN || "/usr/lib/postgresql/17/bin";
  fs.writeFileSync(path.join(os.tmpdir(), "qa-pw"), "postgres");
  execFileSync(`${BIN}/initdb`, ["-D", dir, "-U", "postgres", "--pwfile", path.join(os.tmpdir(), "qa-pw"), "-A", "scram-sha-256"], { stdio: "ignore" });
  execFileSync(`${BIN}/pg_ctl`, ["-D", dir, "-o", `-p ${PORT} -k ${dir} -c listen_addresses=127.0.0.1 -c max_connections=200`, "-w", "start", "-l", path.join(dir, "log")], { stdio: "ignore" });
  server = { stop: async () => execFileSync(`${BIN}/pg_ctl`, ["-D", dir, "-m", "fast", "stop"], { stdio: "ignore" }) };
  const admin = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await admin.connect(); await admin.query("CREATE DATABASE qa"); await admin.end();
  const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "qa" });
  await c.connect();
  if (!fs.existsSync(MIGRATIONS)) throw new Error(`No migrations dir at ${MIGRATIONS} (Backend regenerating?) - nothing to test`);
  const EMU = path.resolve(import.meta.dirname, "../../../src/server/db/tests/supabase_emulation.sql");
  if (fs.existsSync(EMU)) await c.query(fs.readFileSync(EMU, "utf8")); // Backend's emulation preferred
  else await c.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  `);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt);
  }
  // Supabase default privileges: anon/authenticated get table grants on public; RLS is the only gate.
  await c.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`);
  await c.end();
  process.env.QA_MIGRATIONS = files.join(",");
}
export async function teardown() { await server?.stop(); }
