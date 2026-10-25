import { notFound } from "next/navigation";

// Any unknown path under /[locale] renders the localised 404 (with header/footer).
export default function CatchAll() {
  notFound();
}
