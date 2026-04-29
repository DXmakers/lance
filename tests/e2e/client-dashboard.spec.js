"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe('Client Dashboard', () => {
    test_1.test.beforeEach(async ({ page }) => {
        await page.route('**/api/v1/jobs', async (route) => {
            if (route.request().method() === 'GET') {
                const mockJobs = Array.from({ length: 5 }, (_, i) => ({
                    id: `mock-job-${i}`,
                    title: `Active Job ${i}`,
                    description: 'Test',
                    budget_usdc: 1000000000,
                    milestones: 2,
                    client_address: 'GCLIENT',
                    status: 'open',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }));
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(mockJobs)
                });
            }
            else {
                await route.continue();
            }
        });
        // Set role to client via UI
        await page.goto('/');
        await page.getByRole('button', { name: 'Client Log In' }).click();
        // Wait for the client dashboard to load
        await (0, test_1.expect)(page.locator('h1')).toContainText('Manage hiring and escrow milestones');
    });
    (0, test_1.test)('should display client metrics and active registry', async ({ page }) => {
        await (0, test_1.expect)(page.locator('h1')).toContainText('Manage hiring and escrow milestones');
        // Check stats
        await (0, test_1.expect)(page.getByRole('heading', { name: 'Active Jobs' })).toBeVisible();
        await (0, test_1.expect)(page.getByRole('heading', { name: 'Escrow Volume' })).toBeVisible();
        // Check active registry
        await (0, test_1.expect)(page.getByRole('heading', { name: 'Active Registry' })).toBeVisible();
        await (0, test_1.expect)(page.locator('div[class*="group flex items-center justify-between"]')).toHaveCount(5);
    });
});
