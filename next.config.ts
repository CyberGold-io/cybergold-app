import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["sandbox.cybergold.io"],
  devIndicators: false,
  experimental: {
    cpus: 1,
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      // MetaMask SDK contains a statically discoverable React Native-only
      // import. Browser execution always uses its web storage implementation.
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
