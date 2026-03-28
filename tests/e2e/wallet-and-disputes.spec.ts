import { expect, test } from "./fixtures";

test("loads seeded jobs from the mocked Axum backend", async ({ page }) => {
  await page.goto("/jobs");

  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("Escrow release audit")).toBeVisible();
  await expect(page.getByText("in_progress")).toBeVisible();
});

test("creates a job after a deterministic wallet signature", async ({
  page,
  walletPublicKey,
}) => {
  await page.goto("/jobs/new");

  await page.getByRole("button", { name: "Sign and Create Job" }).click();

  await expect(page).toHaveURL("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("Deterministic Soroban integration audit")).toBeVisible();
  await expect(page.getByText(walletPublicKey)).toBeVisible();
});

test("submits evidence with the injected Freighter-compatible wallet", async ({
  page,
  walletPublicKey,
}) => {
  await page.goto("/disputes/11111111-1111-4111-8111-111111111111");

  await expect(page.getByText(/freelancer.*8500 bps/i)).toBeVisible();
  await expect(page.getByText("mock-verdict-tx-0001")).toBeVisible();
  await page.getByRole("button", { name: "Sign and Submit Evidence" }).click();

  await expect(page.getByText("Evidence Recorded")).toBeVisible();
  await expect(page.getByText(walletPublicKey)).toBeVisible();
  await expect(page.getByText('signed:{"action":"submit_evidence"')).toBeVisible();
});
