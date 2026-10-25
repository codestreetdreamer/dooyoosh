// Shared helpers. Everything is driven by env so the suite runs against local `pnpm start`, a preview deploy, or CI.
import { createHash, createHmac, randomUUID } from "node:crypto";

// NB: Vite/Vitest sets process.env.BASE_URL="/" itself, so only honour BASE_URL when it is an absolute URL.
const pick = [process.env.QA_BASE_URL, process.env.BASE_URL].find((v) => v && /^https?:\/\//.test(v));
export const BASE_URL = (pick || "http://localhost:3000/api/v1").replace(/\/$/, "");
export const SITE_URL = BASE_URL.replace(/\/api\/v1$/, "");
export const env = (k) => (process.env[k] && process.env[k].trim()) || undefined;

let upCache;
/** true when the Next server answers anything on BASE_URL within 2s */
export async function serverUp() {
  if (upCache !== undefined) return upCache;
  try { await fetch(`${BASE_URL}/categories`, { signal: AbortSignal.timeout(2000) }); upCache = true; } catch { upCache = false; }
  return upCache;
}
export const UP = await serverUp();
export const DOWN_REASON = `server not reachable at ${BASE_URL} (start it with \`pnpm build && pnpm start\` or set BASE_URL)`;

export async function call(method, path, { body, raw, headers = {}, query } = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const h = { ...headers };
  let payload = raw;
  if (body !== undefined && raw === undefined) { payload = JSON.stringify(body); h["content-type"] ??= "application/json"; }
  const res = await fetch(url, { method, headers: h, body: method === "GET" ? undefined : payload, redirect: "manual" });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

/** A route that does not exist yet: Next's HTML 404 / 405, not our JSON envelope. */
export function notImplemented(r) {
  return (r.status === 404 || r.status === 405) && !(r.json && r.json.error);
}
export function skipIfMissing(ctx, r, what) {
  if (notImplemented(r)) ctx.skip(`${what} not implemented yet (HTTP ${r.status}, no JSON envelope)`);
}
export function expectEnvelope(expect, r, status, code) {
  expect(r.status, r.text.slice(0, 300)).toBe(status);
  expect(r.json?.error?.code, r.text.slice(0, 300)).toBe(code);
  expect(typeof r.json.error.message).toBe("string");
}

export function fillPath(path, overrides = {}) {
  const defaults = { slug: "qa-does-not-exist", id: randomUUID(), reference: "DY-20261022-AAAAA", checkoutId: randomUUID(), provider: "mock" };
  return path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(overrides[k] ?? defaults[k]));
}

/** Admin session credentials per role, supplied by CI/staging as a raw Cookie or Authorization header value. */
export function roleHeaders(role) {
  const cookie = env(`QA_ADMIN_COOKIE_${role.toUpperCase()}`);
  const bearer = env(`QA_ADMIN_BEARER_${role.toUpperCase()}`);
  if (cookie) return { cookie };
  if (bearer) return { authorization: `Bearer ${bearer}` };
  return undefined;
}

export const md5 = (s) => createHash("md5").update(s).digest("hex");
export const signMock = (secret, raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
export { randomUUID };
