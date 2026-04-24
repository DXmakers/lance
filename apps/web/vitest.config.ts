import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    exclude: ["components/wallet/__tests__/**"],
    coverage: {
      reporter: ["text", "html"],
      include: ["components/theme/theme-toggle.tsx", "lib/notifications.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
