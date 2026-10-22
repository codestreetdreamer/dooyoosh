/** GET /api/v1/products (catalog.listProductsQuery -> catalog.listProductsResponse). Owner: Backend & Database. */
import { listProductsQuery, listProductsResponse } from "@/contracts/catalog";
import { withErrors } from "@/lib/errors";
import { parseQuery, respond } from "@/server/catalog/http";
import { listProducts } from "@/server/catalog/products";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => respond(listProductsResponse, await listProducts(parseQuery(listProductsQuery, req))));
