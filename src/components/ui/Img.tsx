import Image, { type ImageProps } from "next/image";

/** next/image wrapper: local SVG placeholders are served unoptimized (next/image refuses SVG optimisation). */
export function Img(props: ImageProps) {
  const src = typeof props.src === "string" ? props.src : "";
  const unoptimized = props.unoptimized ?? src.endsWith(".svg");
  // eslint-disable-next-line jsx-a11y/alt-text -- alt is required by ImageProps and passed through
  return <Image {...props} unoptimized={unoptimized} />;
}
