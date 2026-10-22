import type { ReactNode } from "react";

// The <html> shell lives in app/[locale]/layout.tsx (next-intl pattern). This root layout is a pass-through.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
