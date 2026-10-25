import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Locale-prefix storefront pages only. Never touch /api, /admin, Next internals or static files.
  matcher: ["/((?!api|admin|_next|_vercel|brand|placeholders|.*\\..*).*)"],
};
