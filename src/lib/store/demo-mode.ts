/**
 * Demo mode = payment mode is anything other than "live". Reads the PUBLIC flag NEXT_PUBLIC_PAYMENT_MODE
 * (mirror of the server's PAYMENT_MODE). Unset or unknown => demo (banner SHOWN). Only the exact value "live" hides it.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_PAYMENT_MODE !== "live";
}
