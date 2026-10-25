/** Human order reference DY-YYYYMMDD-XXXXX (spec §2; DB CHECK '^DY-[0-9]{8}-[A-Z2-7]{5}$'). */
import { randomInt } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newOrderReference(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 5; i++) s += BASE32[randomInt(32)];
  return `DY-${d}-${s}`;
}
