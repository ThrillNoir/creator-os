import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  env: {
    THOT_OS_BUILD_TIME: process.env.THOT_OS_BUILD_TIME ?? "unknown",
    THOT_OS_COMPONENT: process.env.THOT_OS_COMPONENT ?? "web",
    THOT_OS_ENVIRONMENT: process.env.THOT_OS_ENVIRONMENT ?? "local",
    THOT_OS_GIT_BRANCH: process.env.THOT_OS_GIT_BRANCH ?? "unknown",
    THOT_OS_GIT_SHA: process.env.THOT_OS_GIT_SHA ?? "unknown",
  },
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default async function configureNext() {
  if (process.env.NODE_ENV === "development") {
    // Local development must not inherit remote staging service/resource access.
    await initOpenNextCloudflareForDev({ remoteBindings: false });
  }
  return nextConfig;
}
