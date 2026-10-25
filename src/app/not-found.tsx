import Link from "next/link";
import "@/styles/globals.css";

// Fallback 404 for paths outside the locale tree (e.g. /admin/unknown). Locale pages use [locale]/not-found.tsx.
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-bg text-ink">
        <main className="px-6 text-center">
          <p className="eyebrow">404</p>
          <h1 className="mt-3 font-serif text-4xl">Page not found</h1>
          <Link href="/en" className="btn btn-outline mt-8">Return home</Link>
        </main>
      </body>
    </html>
  );
}
