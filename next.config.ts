import type { NextConfig } from "next";

// next-intl plugin is wired by Frontend & Design once src/i18n/request.ts exists:
//   import createNextIntlPlugin from "next-intl/plugin";
//   export default createNextIntlPlugin()(nextConfig);
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/product-images/**" }],
  },
  // Webhooks need the raw body: route handlers read `await req.text()` before parsing (spec §11).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
