import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), "../../"),
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any, { isServer }: { isServer: boolean }) {
    if (!isServer) {
      // sodium-native and require-addon are Node.js native modules pulled in
      // by @stellar/stellar-sdk. They cannot be compiled by webpack for the
      // browser — mark them false so the bundle stays clean.
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "sodium-native": false,
        "require-addon": false,
      };
    }
    return config;
  },
};

export default nextConfig;
