import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,

    coverage: {
      reporter: ["text", "html"],
      include: [
        "components/jobs/submit-bid-modal.tsx",
        "lib/validation/submit-bid.ts",
        "components/theme/theme-toggle.tsx",
        "lib/notifications.ts",
      ],
    },
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});