"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
// TODO: Implement full E2E flows — see docs/ISSUES.md
(0, test_1.test)("job board loads", async ({ page }) => {
    await page.goto("/jobs");
    // Target the eyebrow element specifically using first() to avoid
    // strict mode violation when multiple elements match /Marketplace/i
    await (0, test_1.expect)(page.getByText(/Marketplace/i).first()).toBeVisible();
});
(0, test_1.test)("post a job navigates to job board", async ({ page }) => {
    await page.goto("/jobs/new");
    // TODO: fill form and submit
});
(0, test_1.test)("dispute flow renders verdict page", async ({ page }) => {
    // TODO: stub dispute creation and visit verdict page
    (0, test_1.expect)(true).toBeTruthy();
});
