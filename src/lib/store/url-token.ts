"use client";
import { useLayoutEffect, useState } from "react";

/**
 * Guest access tokens arrive as ?token= (provider return URL / email link). To stop them leaking via Referer,
 * history or screenshots we: read it once client-side, keep it in sessionStorage (scoped by checkout/order),
 * and strip it from the address bar with history.replaceState.
 */
const PREFIX = "dooyoosh.token.";

export function storeToken(scope: string, token: string) {
  try { window.sessionStorage.setItem(PREFIX + scope, token); } catch { /* storage unavailable */ }
}

export function readToken(scope: string): string | null {
  try { return window.sessionStorage.getItem(PREFIX + scope); } catch { return null; }
}

/**
 * Returns undefined while resolving, then the token or null.
 * Order of preference: token already in sessionStorage for this scope > ?token= in the URL.
 * The URL param is always stripped (useLayoutEffect = before first paint after hydration). Never logged.
 */
export function useUrlToken(scope: string | null): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("token");
    if (fromUrl !== null) {
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const stored = scope ? readToken(scope) : null;
    const resolved = stored ?? fromUrl ?? null;
    if (resolved && scope && !stored) storeToken(scope, resolved);
    setToken(resolved);
  }, [scope]);
  return token;
}
