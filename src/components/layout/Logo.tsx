import Image from "next/image";

/**
 * PLACEHOLDER logo: cropped from the gallery screenshot (design/logo-screenshot.png).
 * Replace public/brand/wordmark.png with the original SVG when Mirfozil provides it.
 */
export function Wordmark({ className = "h-7 w-auto md:h-8" }: { className?: string }) {
  return <Image src="/brand/wordmark.png" alt="Dooyoosh" width={576} height={112} priority className={className} />;
}

export function Monogram({ className = "h-16 w-16" }: { className?: string }) {
  return <Image src="/brand/mark.png" alt="" width={319} height={320} className={className} />;
}
