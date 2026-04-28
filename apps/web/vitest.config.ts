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
        "components/theme/theme-toggle.tsx",
        "components/jobs/post-job-form.tsx",
        "components/jobs/post-job-error-boundary.tsx",
        "lib/validations/post-job-schema.ts",
        "lib/notifications.ts",
        "lib/profile.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
