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
/**
 * Mirrors next.config.ts images.remotePatterns (Architect-owned). Remote URLs outside it would make next/image throw
 * during render, so they degrade to the placeholder instead. Keep in sync if remotePatterns changes.
 */
export function isAllowedImageSrc(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/storage/v1/object/public/product-images/");
  } catch {
    return false;
  }
}

export function Img({ src, alt, ...rest }: Omit<ImageProps, "src"> & { src: ImageProps["src"] | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const bad = !src || failed || (typeof src === "string" && !isAllowedImageSrc(src));
  const resolved = bad ? IMAGE_FALLBACK : src;
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
