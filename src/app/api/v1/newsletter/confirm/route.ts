/** GET /api/v1/newsletter/confirm?token= (journal.newsletterConfirmQuery -> journal.newsletterConfirmResponse; 404 bad/expired). */
import { newsletterConfirmQuery, newsletterConfirmResponse } from "@/contracts/journal";
import { withErrors } from "@/lib/errors";
import { CACHE_NONE, parseQuery, respond } from "@/server/catalog/http";
import { confirm } from "@/server/journal/newsletter";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  await confirm(parseQuery(newsletterConfirmQuery, req).token);
  return respond(newsletterConfirmResponse, { data: { status: "confirmed" } }, { cache: CACHE_NONE });
});
