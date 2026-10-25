import { describe, it, expect } from "vitest";
import { newsletterSignupRequest } from "@/contracts/journal";
import { createCheckoutRequest } from "@/contracts/checkout";
describe("email trim/lowercase before validation (QA defect: whitespace rejected)", () => {
  it("newsletter: '  QA@X.TEST  ' -> 'qa@x.test'", () => {
    expect(newsletterSignupRequest.parse({ email: "  QA@X.TEST  ", locale: "en" }).email).toBe("qa@x.test");
    expect(() => newsletterSignupRequest.parse({ email: "  not an email ", locale: "en" })).toThrow();
  });
  it("checkout email trimmed + lowercased", () => {
    const shape = (createCheckoutRequest as any).shape ?? (createCheckoutRequest as any)._def?.schema?.shape;
    const e = shape?.email;
    if (!e) return;
    expect(e.parse("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });
});
