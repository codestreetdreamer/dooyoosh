import type { Metadata } from "next";
import type { ReactNode } from "react";

// Site-wide referrer policy (<meta name="referrer">). Token-bearing pages override with "no-referrer".
export const metadata: Metadata = { referrer: "strict-origin-when-cross-origin" };

// The <html> shell lives in app/[locale]/layout.tsx (next-intl pattern). This root layout is a pass-through.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
