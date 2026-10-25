"use client";
/** Tracks the server's stock reservation (reservedUntil from POST /checkout) for the countdown notice. */
const KEY = "dooyoosh.reservation.v1";
export type Reservation = { checkoutId: string; token: string | null; reservedUntil: string; expiresAt: string };

export function saveReservation(r: Reservation) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* storage unavailable */ }
}
export function readReservation(): Reservation | null {
  try {
    const r = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as Reservation | null;
    if (!r || Date.parse(r.reservedUntil) <= Date.now()) return null;
    return r;
  } catch { return null; }
}
export function clearReservation() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
