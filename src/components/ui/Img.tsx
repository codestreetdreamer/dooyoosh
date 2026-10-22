"use client";
import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/** Branded placeholder used when an image URL is null/empty or fails to load (e.g. demo images not uploaded yet). */
export const IMAGE_FALLBACK = "/brand/placeholder.svg";

/**
 * next/image wrapper.
 * - Local SVG placeholders are served unoptimized (next/image refuses to optimise SVG).
 * - Missing or broken sources (e.g. a deleted Supabase Storage object) fall back to a neutral placeholder.
 */
export function Img({ src, alt, ...rest }: Omit<ImageProps, "src"> & { src: ImageProps["src"] | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const resolved = !src || failed ? IMAGE_FALLBACK : src;
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
