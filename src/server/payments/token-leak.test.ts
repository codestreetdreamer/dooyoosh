/** QA P1: the guest token never appears in any URL an adapter produces (ours or a third-party host). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "../checkout/service";
import { setup } from "./__tests__/fixtures";

const decodeAll = (url: string) => {
  // Payme puts its params base64-encoded in the path; decode every path segment that looks like base64
  const u = new URL(url);
  const segs = u.pathname.split("/").filter(Boolean).map((s) => { try { return Buffer.from(s, "base64").toString("utf8"); } catch { return ""; } });
  return [url, decodeURIComponent(url), ...segs].join("\n");
};

describe("no adapter URL contains the guest token", () => {
  it.each([
    ["mock", "sandbox"], ["payme", "sandbox"], ["payme", "live"], ["click", "sandbox"], ["click", "live"],
  ] as const)("%s / %s", async (name, mode) => {
    const f = setup(name, { mode, fiscal: true });
    if (mode === "live") f.deps.config.siteUrl = "https://shop.example";
    const spy = vi.spyOn(f.provider, "createSession");
    const d = await createCheckout(f.deps, f.provider, f.request());
    const input = spy.mock.calls[0]![0];
    for (const url of [d.redirectUrl, input.successUrl, input.cancelUrl]) {
      expect(decodeAll(url)).not.toContain(d.accessToken);
      expect(new URL(url).searchParams.has("token")).toBe(false);
    }
    expect(d.accessToken.length).toBeGreaterThanOrEqual(32);
  });
});

describe("POST /sandbox-pay token transport", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("rejects a token in the query string (400) even when the gate is open", async () => {
    vi.stubEnv("PAYMENT_MODE", "sandbox");
    vi.stubEnv("SANDBOX_SIMULATOR_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    const { POST } = await import("@/app/api/v1/checkout/[checkoutId]/sandbox-pay/route");
    const id = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e0f";
    const res = await POST(new Request(`http://x/api/v1/checkout/${id}/sandbox-pay?token=${"a".repeat(43)}`, { method: "POST", body: JSON.stringify({ token: "a".repeat(43) }) }), { params: Promise.resolve({ checkoutId: id }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/body/);
  });
});
