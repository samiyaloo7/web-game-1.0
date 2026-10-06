import type { NextConfig } from "next";

/**
 * Headers that matter for the PWA/Offline work:
 *
 *  - `/sw.js` is the service worker. It must NEVER be cached, or browsers would
 *    keep running an old worker (with its old cache name) long after a deploy;
 *    `no-cache, no-store, must-revalidate` forces a revalidation on every
 *    registration. The worker's own CSP (`default-src 'self'`) is applied to the
 *    worker's global scope, which pins it to same-origin `fetch()` — a stolen or
 *    confused worker cannot exfiltrate to a third party. See `PWA.md`.
 *  - `/api/*` is `no-store`: those responses are session-scoped and a function
 *    of the current clock. The service worker already refuses to intercept
 *    them; this is the second lock on the same door (browser HTTP cache).
 *  - The first three are baseline document hardening, from the Next.js PWA guide.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
