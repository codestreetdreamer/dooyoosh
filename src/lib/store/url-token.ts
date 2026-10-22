"use client";
import { useLayoutEffect, useState } from "react";

/**
 * Guest access tokens NEVER travel in URLs (contract cfd5cee). POST /checkout returns the token once; we keep it in
 * sessionStorage keyed by checkout id, and map order reference -> token once the status endpoint reveals the reference.
 */
const PREFIX = "dooyoosh.token.";
export const checkoutScope = (checkoutId: string) => `checkout:${checkoutId}`;
export const orderScope = (reference: string) => `order:${reference}`;

export function storeToken(scope: string, token: string) {
  try { window.sessionStorage.setItem(PREFIX + scope, token); } catch { /* storage unavailable */ }
}

export function readToken(scope: string): string | null {
  try { return window.sessionStorage.getItem(PREFIX + scope); } catch { return null; }
}

/**
 * Returns undefined while resolving, then the stored token or null. Tokens are never read from the query string;
 * any stray `token` query param is removed from the address bar before first paint (defence in depth).
 *
 * `acceptHashToken` (order page only): confirmation-email links carry `#token=<accessToken>` — a URL fragment, which
 * browsers never send to servers or in Referer. It is moved to sessionStorage and the hash is stripped immediately.
 */
export function useStoredToken(scope: string | null, opts: { acceptHashToken?: boolean } = {}): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const acceptHash = !!opts.acceptHashToken;
  useLayoutEffect(() => {
    const url = new URL(window.location.href);
    let hashToken: string | null = null;
    if (url.hash) {
      const h = new URLSearchParams(url.hash.slice(1));
      if (h.has("token")) {
        if (acceptHash) hashToken = h.get("token");
        url.hash = "";
      }
    }
    if (url.searchParams.has("token")) url.searchParams.delete("token");
    const clean = url.pathname + url.search + url.hash;
    if (clean !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", clean);
    }
    if (hashToken && hashToken.length >= 32 && scope) storeToken(scope, hashToken);
    setToken(scope ? readToken(scope) : null);
  }, [scope, acceptHash]);
  return token;
}
