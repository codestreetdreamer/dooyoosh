"use client";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";

const FALLBACK = "/placeholders/hero-1.svg";

/**
 * next/image wrapper.
 * - Local SVG placeholders are served unoptimized (next/image refuses to optimise SVG).
 * - Missing or broken sources (e.g. a deleted Supabase Storage object) fall back to a neutral placeholder.
 */
export function Img({ src, alt, ...rest }: Omit<ImageProps, "src"> & { src: ImageProps["src"] | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const resolved = !src || failed ? FALLBACK : src;
  const isSvg = typeof resolved === "string" && resolved.endsWith(".svg");
  return (
    <Image
      {...rest}
      src={resolved}
      alt={alt}
      unoptimized={rest.unoptimized ?? isSvg}
      onError={(e) => {
        if (!failed) setFailed(true);
        rest.onError?.(e);
      }}
    />
  );
}
