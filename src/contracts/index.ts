/**
 * Contracts barrel + endpoint registry (single source for api-client.ts and docs/CONTRACTS.md).
 * Changes here need Architect approval (OWNERSHIP.md).
 */
import { z } from "zod";
import * as admin from "./admin";
import * as cart from "./cart";
import * as catalog from "./catalog";
import * as checkout from "./checkout";

import * as inventory from "./inventory";
import * as journal from "./journal";
import * as orders from "./orders";
import * as payments from "./payments";
import * as shipping from "./shipping";

export * as adminContracts from "./admin";
export * as cartContracts from "./cart";
export * as catalogContracts from "./catalog";
export * as checkoutContracts from "./checkout";
export * as inventoryContracts from "./inventory";
export * as journalContracts from "./journal";
export * as orderContracts from "./orders";
export * as paymentContracts from "./payments";
export * as shippingContracts from "./shipping";
export * from "./common";
export type { PaymentProvider, NormalizedPaymentEvent, CheckoutForPayment, CreateSessionResult } from "./payments";
export type { InventoryService } from "./inventory";

export type Owner = "Backend & Database" | "Payments & Orders" | "Architect";
export type Auth = "public" | "admin" | "webhook" | "cron";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface EndpointDef {
  method: HttpMethod;
  /** path relative to /api/v1, params as {name} */
  path: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** undefined = non-JSON / provider-specific response (webhooks) */
  response?: z.ZodType;
  owner: Owner;
  auth: Auth;
  roles?: readonly admin.AdminRole[];
  successStatus?: number;
}

const def = <T extends EndpointDef>(d: T) => d;
const id = admin.idParams;
const paginatedMovements = z.object({ data: z.array(inventory.inventoryMovement), page: z.object({ cursor: z.string().nullable(), limit: z.number() }) });
const BD = "Backend & Database" as const;
const PO = "Payments & Orders" as const;

export const endpoints = {
  // ---------- Public ----------
  listProducts: def({ method: "GET", path: "/products", query: catalog.listProductsQuery, response: catalog.listProductsResponse, owner: BD, auth: "public" }),
  productFacets: def({ method: "GET", path: "/products/facets", query: catalog.productFacetsQuery, response: catalog.productFacetsResponse, owner: BD, auth: "public" }),
  getProduct: def({ method: "GET", path: "/products/{slug}", params: catalog.productParams, query: catalog.getProductQuery, response: catalog.getProductResponse, owner: BD, auth: "public" }),
  listCategories: def({ method: "GET", path: "/categories", query: catalog.listCategoriesQuery, response: catalog.listCategoriesResponse, owner: BD, auth: "public" }),
  search: def({ method: "GET", path: "/search", query: catalog.searchQuery, response: catalog.searchResponse, owner: BD, auth: "public" }),
  validateCart: def({ method: "POST", path: "/cart/validate", body: cart.validateCartRequest, response: cart.validateCartResponse, owner: BD, auth: "public" }),
  shippingOptions: def({ method: "GET", path: "/shipping/options", query: shipping.shippingOptionsQuery, response: shipping.shippingOptionsResponse, owner: BD, auth: "public" }),
  createCheckout: def({ method: "POST", path: "/checkout", body: checkout.createCheckoutRequest, response: checkout.createCheckoutResponse, owner: PO, auth: "public", successStatus: 201 }),
  checkoutStatus: def({ method: "GET", path: "/checkout/{checkoutId}/status", params: orders.checkoutStatusParams, query: orders.checkoutStatusQuery, response: orders.checkoutStatusResponse, owner: PO, auth: "public" }),
  getOrder: def({ method: "GET", path: "/orders/{reference}", params: orders.orderParams, query: orders.getOrderQuery, response: orders.getOrderResponse, owner: PO, auth: "public" }),
  listArticles: def({ method: "GET", path: "/articles", query: journal.listArticlesQuery, response: journal.listArticlesResponse, owner: BD, auth: "public" }),
  getArticle: def({ method: "GET", path: "/articles/{slug}", params: journal.articleParams, query: journal.getArticleQuery, response: journal.getArticleResponse, owner: BD, auth: "public" }),
  newsletterSignup: def({ method: "POST", path: "/newsletter", body: journal.newsletterSignupRequest, response: journal.newsletterSignupResponse, owner: BD, auth: "public", successStatus: 202 }),
  newsletterConfirm: def({ method: "GET", path: "/newsletter/confirm", query: journal.newsletterConfirmQuery, response: journal.newsletterConfirmResponse, owner: BD, auth: "public" }),
  paymentWebhook: def({ method: "POST", path: "/webhooks/{provider}", params: payments.webhookParams, owner: PO, auth: "webhook" }),
  cronReleaseExpired: def({ method: "POST", path: "/cron/release-expired", response: inventory.releaseExpiredResponse, owner: PO, auth: "cron" }),

  // ---------- Admin ----------
  adminListProducts: def({ method: "GET", path: "/admin/products", query: admin.adminListProductsQuery, response: admin.adminListProductsResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminCreateProduct: def({ method: "POST", path: "/admin/products", body: admin.createProductRequest, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"], successStatus: 201 }),
  adminGetProduct: def({ method: "GET", path: "/admin/products/{id}", params: id, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminUpdateProduct: def({ method: "PATCH", path: "/admin/products/{id}", params: id, body: admin.updateProductRequest, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminArchiveProduct: def({ method: "DELETE", path: "/admin/products/{id}", params: id, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminPublishProduct: def({ method: "POST", path: "/admin/products/{id}/publish", params: id, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminUnpublishProduct: def({ method: "POST", path: "/admin/products/{id}/unpublish", params: id, response: admin.adminProductResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminCreateVariant: def({ method: "POST", path: "/admin/products/{id}/variants", params: id, body: admin.createVariantRequest, response: admin.adminVariantResponse, owner: BD, auth: "admin", roles: ["owner", "editor"], successStatus: 201 }),
  adminUpdateVariant: def({ method: "PATCH", path: "/admin/variants/{id}", params: id, body: admin.updateVariantRequest, response: admin.adminVariantResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminAdjustStock: def({ method: "POST", path: "/admin/variants/{id}/adjust", params: id, body: inventory.adjustStockRequest, response: inventory.adjustStockResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"] }),
  adminListMovements: def({ method: "GET", path: "/admin/variants/{id}/movements", params: id, query: admin.listMovementsQuery, response: paginatedMovements, owner: BD, auth: "admin", roles: ["owner", "fulfilment"] }),
  adminListOrders: def({ method: "GET", path: "/admin/orders", query: admin.adminListOrdersQuery, response: admin.adminListOrdersResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"] }),
  adminGetOrder: def({ method: "GET", path: "/admin/orders/{id}", params: id, response: admin.adminOrderResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"] }),
  adminTransitionOrder: def({ method: "POST", path: "/admin/orders/{id}/transition", params: id, body: admin.transitionOrderRequest, response: admin.adminOrderResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"] }),
  adminRefundOrder: def({ method: "POST", path: "/admin/orders/{id}/refund", params: id, body: admin.refundOrderRequest, response: admin.refundOrderResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"], successStatus: 201 }),
  adminCreateShipment: def({ method: "POST", path: "/admin/orders/{id}/shipments", params: id, body: admin.createShipmentRequest, response: admin.createShipmentResponse, owner: PO, auth: "admin", roles: ["owner", "fulfilment"], successStatus: 201 }),
  adminListArticles: def({ method: "GET", path: "/admin/articles", query: admin.adminListArticlesQuery, response: admin.adminListArticlesResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminCreateArticle: def({ method: "POST", path: "/admin/articles", body: admin.createArticleRequest, response: admin.adminArticleResponse, owner: BD, auth: "admin", roles: ["owner", "editor"], successStatus: 201 }),
  adminUpdateArticle: def({ method: "PATCH", path: "/admin/articles/{id}", params: id, body: admin.updateArticleRequest, response: admin.adminArticleResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminArchiveArticle: def({ method: "DELETE", path: "/admin/articles/{id}", params: id, response: admin.adminArticleResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminPublishArticle: def({ method: "POST", path: "/admin/articles/{id}/publish", params: id, body: admin.publishArticleRequest, response: admin.adminArticleResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
  adminMediaUploadUrl: def({ method: "POST", path: "/admin/media/upload-url", body: admin.mediaUploadUrlRequest, response: admin.mediaUploadUrlResponse, owner: BD, auth: "admin", roles: ["owner", "editor"] }),
} as const satisfies Record<string, EndpointDef>;

export type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;

