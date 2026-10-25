"use client";
/**
 * Client bag (spec §2: the client cart is a HINT; server recomputes prices/stock at /cart/validate and /checkout).
 * Persisted in localStorage. The snapshot fields are only for instant rendering before validation returns.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MAX_CART_LINES, MAX_LINE_QTY } from "@/contracts/cart";

export type BagLine = {
  variantId: string;
  quantity: number;
  snapshot: {
    productSlug: string;
    productName: string;
    size: string | null;
    colour: string | null;
    imageUrl: string | null;
    unitPriceMinor: number;
    currency: string;
  };
};

type BagContextValue = {
  lines: BagLine[];
  ready: boolean;
  count: number;
  add: (line: BagLine) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  replace: (lines: BagLine[]) => void;
  clear: () => void;
};

const STORAGE_KEY = "dooyoosh.bag.v1";
const BagContext = createContext<BagContextValue | null>(null);

function clampQty(q: number) {
  return Math.max(1, Math.min(MAX_LINE_QTY, Math.floor(q)));
}

function load(): BagLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l): l is BagLine => typeof l?.variantId === "string" && Number.isInteger(l?.quantity) && typeof l?.snapshot === "object")
      .slice(0, MAX_CART_LINES)
      .map((l) => ({ ...l, quantity: clampQty(l.quantity) }));
  } catch {
    return [];
  }
}

export function BagProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<BagLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(load());
    setReady(true);
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && setLines(load());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines, ready]);

  const add = useCallback((line: BagLine) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === line.variantId);
      if (existing) {
        return prev.map((l) => (l.variantId === line.variantId ? { ...l, quantity: clampQty(l.quantity + line.quantity) } : l));
      }
      if (prev.length >= MAX_CART_LINES) return prev;
      return [...prev, { ...line, quantity: clampQty(line.quantity) }];
    });
  }, []);
  const setQuantity = useCallback((variantId: string, quantity: number) => {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity: clampQty(quantity) } : l)));
  }, []);
  const remove = useCallback((variantId: string) => setLines((prev) => prev.filter((l) => l.variantId !== variantId)), []);
  const replace = useCallback((next: BagLine[]) => setLines(next), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<BagContextValue>(
    () => ({ lines, ready, count: lines.reduce((n, l) => n + l.quantity, 0), add, setQuantity, remove, replace, clear }),
    [lines, ready, add, setQuantity, remove, replace, clear],
  );
  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): BagContextValue {
  const ctx = useContext(BagContext);
  if (!ctx) throw new Error("useBag must be used inside <BagProvider>");
  return ctx;
}
