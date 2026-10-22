// Starts a throwaway local Postgres 17 (same major as the Supabase project), applies Supabase emulation,
// then every migration in src/server/db/migrations (journal order first, then any extra *.sql sorted).
// Never touches the real Supabase project.
import { execFileSync } from "node:child_process";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const PORT = Number(process.env.QA_PG_PORT || 54329);
const ROOT = path.resolve(import.meta.dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "src/server/db/migrations");
const EMU = path.join(ROOT, "src/server/db/tests/supabase_emulation.sql");

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS)) throw new Error(`No migrations dir at ${MIGRATIONS} - nothing to test`);
  const all = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let journal = [];
  try { journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")).entries.map((e) => `${e.tag}.sql`); } catch {}
  const ordered = journal.filter((f) => all.includes(f));
  return [...ordered, ...all.filter((f) => !ordered.includes(f))];
}

let stop;
export async function setup() {
  const BIN = process.env.PG_BIN || "/usr/lib/postgresql/17/bin";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dooyoosh-qa-pg-"));
  const pw = path.join(dir, "..", `qa-pw-${path.basename(dir)}`);
  fs.writeFileSync(pw, "postgres");
  execFileSync(`${BIN}/initdb`, ["-D", dir, "-U", "postgres", "--pwfile", pw, "-A", "scram-sha-256"], { stdio: "ignore" });
  execFileSync(`${BIN}/pg_ctl`, ["-D", dir, "-o", `-p ${PORT} -k ${dir} -c listen_addresses=127.0.0.1 -c max_connections=200`, "-w", "start", "-l", path.join(dir, "log")], { stdio: "ignore" });
  stop = () => execFileSync(`${BIN}/pg_ctl`, ["-D", dir, "-m", "fast", "stop"], { stdio: "ignore" });
  const conn = { host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres" };
  const admin = new pg.Client({ ...conn, database: "postgres" });
  await admin.connect(); await admin.query("CREATE DATABASE qa"); await admin.end();
  const c = new pg.Client({ ...conn, database: "qa" });
  await c.connect();
  if (fs.existsSync(EMU)) {
    await c.query(fs.readFileSync(EMU, "utf8")); // Backend's emulation: Supabase default privileges BEFORE migrations
  } else {
    await c.query(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb default '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  }
  const files = migrationFiles();
  const applied = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const stmts = sql.split("--> statement-breakpoint").filter((s) => s.replace(/--.*$/gm, "").trim());
    if (!stmts.length) continue; // empty stub
    try { for (const s of stmts) await c.query(s); } catch (e) { await c.end(); stop(); throw new Error(`Migration ${f} failed: ${e.message}`); }
    applied.push(f);
  }
  await c.end();
  fs.writeFileSync(path.join(import.meta.dirname, ".applied-migrations"), applied.join("\n"));
  console.log(`[qa-db] applied: ${applied.join(", ")}`);
}
export async function teardown() { stop?.(); }
