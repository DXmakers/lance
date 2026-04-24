import { test, expect } from "@playwright/test";

test("can save and unsave jobs from the marketplace", async ({ page }) => {
  // 1. Go to jobs page
  await page.goto("/jobs");
  
  // 2. Find the first job card and its save button
  const firstJobCard = page.locator(".group.relative").first();
  const saveButton = firstJobCard.locator("button[aria-label='Save job']");
  
  // 3. Click save
  await saveButton.click();
  
  // 4. Verify button state changes
  await expect(firstJobCard.locator("button[aria-label='Unsave job']")).toBeVisible();
  
  // 5. Go to saved jobs page
  await page.goto("/jobs/saved");
  
  // 6. Verify the job is there
  await expect(page.locator(".group.relative")).toHaveCount(1);
  
  // 7. Unsave from the saved jobs page
  await page.locator("button[aria-label='Unsave job']").click();
  
  // 8. Verify the empty state
  await expect(page.getByText("No saved jobs yet")).toBeVisible();
});

test("saved jobs persist across sessions", async ({ page }) => {
  // 1. Go to jobs page and save a job
  await page.goto("/jobs");
  await page.locator("button[aria-label='Save job']").first().click();
  
  // 2. Reload the page
  await page.reload();
  
  // 3. Verify it's still saved
  await expect(page.locator("button[aria-label='Unsave job']").first()).toBeVisible();
  
  // 4. Go to saved jobs page
  await page.goto("/jobs/saved");
  await expect(page.locator(".group.relative")).toHaveCount(1);
});
