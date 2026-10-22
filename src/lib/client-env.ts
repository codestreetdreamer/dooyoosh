/** Browser-safe env (Architect-owned). Import this in client code, never src/lib/env.ts (keeps server var names out of the bundle). */
import { z } from "zod";

export const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),
  /** drives the non-dismissable demo banner; banner shows unless this is exactly "live". Must equal PAYMENT_MODE. */
  NEXT_PUBLIC_PAYMENT_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
});
export type ClientEnv = z.infer<typeof clientSchema>;

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  const r = clientSchema.safeParse(source);
  if (!r.success) throw new Error(`Invalid client environment:\n${r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  return r.data;
}

// NEXT_PUBLIC_* must be referenced literally so Next.js inlines them in the client bundle.
let cachedClient: ClientEnv | undefined;
export function clientEnv(): ClientEnv {
  cachedClient ??= parseClientEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_PAYMENT_MODE: process.env.NEXT_PUBLIC_PAYMENT_MODE,
  });
  return cachedClient;
}
