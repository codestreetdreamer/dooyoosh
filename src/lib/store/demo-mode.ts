import { clientEnv } from "@/lib/client-env";

/**
 * Demo mode = payment mode is anything other than "live" (per Architect: clientEnv().NEXT_PUBLIC_PAYMENT_MODE !== "live").
 * If client env fails validation (e.g. local fixtures run without Supabase vars), fail safe: treat as demo (banner SHOWN).
 */
export function isDemoMode(): boolean {
  try {
    return clientEnv().NEXT_PUBLIC_PAYMENT_MODE !== "live";
  } catch {
    return true;
  }
}
