"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const WEB_PORT = 3000;
const API_PORT = 3001;
exports.default = (0, test_1.defineConfig)({
    testDir: "./tests/e2e",
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    reporter: [["list"], ["html", { open: "never" }]],
    timeout: 90000,
    expect: {
        timeout: 10000,
    },
    use: {
        baseURL: `http://127.0.0.1:${WEB_PORT}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
    },
    webServer: [
        {
            command: "node tests/e2e/mock-backend.mjs",
            port: API_PORT,
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            env: {
                PORT: String(API_PORT),
            },
        },
        {
            command: "npm run start:web:e2e",
            port: WEB_PORT,
            reuseExistingServer: !process.env.CI,
            timeout: 600000,
            env: {
                NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
            },
        },
    ],
    projects: [
        {
            name: "chromium",
            use: { ...test_1.devices["Desktop Chrome"] },
        },
    ],
});
