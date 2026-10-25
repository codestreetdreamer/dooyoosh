/**
 * Server-side admin authorization for Payments & Orders admin routes. Never trusts the UI: every admin route calls
 * requireAdmin(req, area) first, and the role check uses contracts ROLE_MATRIX.
 *
 * Real implementation = Backend & Database (src/server/auth: Supabase session + admin_users role + TOTP). Until it
 * lands, the resolver FAILS CLOSED (401) except for one dev-only path:
 *   ADMIN_DEV_TOKEN (>= 32 chars) as `Authorization: Bearer <token>`, accepted ONLY when PAYMENTS_STORE=memory and
 *   NODE_ENV != production and PAYMENT_MODE != live (ignored there even if set; src/lib/env.ts also refuses to boot). Role = owner, actorId = ADMIN_DEV_ACTOR_ID.
 * Backend plugs in with setAdminResolver(resolver) from its auth module.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { ROLE_MATRIX, type AdminArea, type AdminRole } from "@/contracts/admin";
import { ApiError } from "@/lib/errors";

export interface AdminPrincipal { actorId: string; role: AdminRole }
export type AdminResolver = (req: Request) => Promise<AdminPrincipal | null>;

export const ADMIN_DEV_ACTOR_ID = "00000000-0000-4000-a000-00000000ad01";

type Env = Record<string, string | undefined>;
const sha = (s: string) => createHash("sha256").update(s).digest();

export function devTokenResolver(env: Env): AdminResolver {
  return async (req) => {
    const tok = env.ADMIN_DEV_TOKEN;
    if (env.PAYMENTS_STORE !== "memory" || env.NODE_ENV === "production" || env.PAYMENT_MODE === "live" || !tok || tok.length < 32) return null;
    const h = req.headers.get("authorization") ?? "";
    if (!h.startsWith("Bearer ")) return null;
    return timingSafeEqual(sha(h.slice(7)), sha(tok)) ? { actorId: ADMIN_DEV_ACTOR_ID, role: "owner" } : null;
  };
}

const g = globalThis as unknown as { __dyAdminResolver?: AdminResolver };
export function setAdminResolver(r: AdminResolver) { g.__dyAdminResolver = r; }

export async function requireAdmin(req: Request, area: AdminArea, resolver: AdminResolver = g.__dyAdminResolver ?? devTokenResolver(process.env)): Promise<AdminPrincipal> {
  const p = await resolver(req);
  if (!p) throw ApiError.unauthorized();
  if (!ROLE_MATRIX[p.role]?.includes(area)) throw ApiError.forbidden();
  return p;
}
