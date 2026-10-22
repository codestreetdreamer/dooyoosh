"use client";
import { useEffect, useState } from "react";
import { readReservation } from "@/lib/store/reservation";

/** Shows the 35-minute hold copy, plus a live countdown when a server reservation (reservedUntil) exists. */
export function ReservationNotice({ text, reservedUntil, countdownLabel = "Reserved for {time}" }: { text: string; reservedUntil?: string | null; countdownLabel?: string }) {
  const [until, setUntil] = useState<string | null>(reservedUntil ?? null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!reservedUntil) setUntil(readReservation()?.reservedUntil ?? null);
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [reservedUntil]);
  const left = until && now ? Math.max(0, Date.parse(until) - now) : null;
  const mm = left !== null ? String(Math.floor(left / 60000)).padStart(2, "0") : null;
  const ss = left !== null ? String(Math.floor((left % 60000) / 1000)).padStart(2, "0") : null;
  return (
    <p className="border-l-2 border-accent bg-surface px-4 py-3 text-sm text-muted">
      {text}
      {left !== null && left > 0 ? (
        <span className="mt-1 block font-medium text-ink">
          {countdownLabel.replace("{time}", `${mm}:${ss}`)}
        </span>
      ) : null}
    </p>
  );
}
