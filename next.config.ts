import type { NextConfig } from "next";

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";
// DESKATLAS_STATIC=1 exports a static site for the packaged desktop build,
// where FastAPI serves these files and the API from one origin.
const staticExport = process.env.DESKATLAS_STATIC === "1";

const nextConfig: NextConfig = staticExport
  ? {
      output: "export",
      devIndicators: false,
      images: { unoptimized: true },
    }
  : {
      output: "standalone",
      devIndicators: false,
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
      },
    };

export default nextConfig;
