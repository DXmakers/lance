import { test, expect } from '@playwright/test';

test.describe('Client Dashboard', () => {
  test.beforeEach(async ({ page }) => {
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
      } else {
        await route.continue();
      }
    });

    // Set role to client via UI
    await page.goto('/');
    await page.getByRole('button', { name: 'Client Log In' }).click();
    
    // Wait for the client dashboard to load
    await expect(page.locator('h1')).toContainText('Manage hiring and escrow milestones');
  });

  test('should display client metrics and active registry', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Manage hiring and escrow milestones');
    
    // Check stats
    await expect(page.getByRole('heading', { name: 'Active Jobs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escrow Volume' })).toBeVisible();
    
    // Check active registry
    await expect(page.getByRole('heading', { name: 'Active Registry' })).toBeVisible();
    await expect(page.locator('div[class*="group flex items-center justify-between"]')).toHaveCount(5);
  });
});
