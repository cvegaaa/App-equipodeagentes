import type { NextConfig } from "next";

// output: "standalone" es requerido por el Dockerfile (build multi-stage que copia
// .next/standalone) y por el Verify de E1-T1 (`test -d .next/standalone`) — sin esto, `next build`
// no genera ese directorio y ambos fallan.
const nextConfig: NextConfig = {
  output: "standalone",
  // Habilita forbidden()/unauthorized() de next/navigation — /app/observabilidad los necesita para
  // responder 403 (no 404) a quien no es geifem_admin, ver E3-T3.
  experimental: { authInterrupts: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
