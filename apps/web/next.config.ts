import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  transpilePackages: ["@timeoff/ui", "@timeoff/db", "@timeoff/domain", "@timeoff/email"],
  serverExternalPackages: ["@prisma/client", "bcryptjs", "bullmq", "ioredis"],
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
