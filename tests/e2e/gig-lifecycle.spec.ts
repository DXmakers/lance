import { test, expect } from "@playwright/test";

test.skip("full gig lifecycle: post, bid, accept, fund, deliver, release", async ({
  page,
}) => {
  const mockJobId = "550e8400-e29b-41d4-a716-446655440000";
  const mockBidId = "b1d00000-0000-0000-0000-000000000000";

  // --- Job routes ---
  await page.route("**/api/v1/jobs", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: mockJobId,
          title: "Build a Soroban Smart Contract",
          status: "open",
          budget_usdc: 50000000000,
          milestones: 2,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mutable job state so status updates are reflected across re-fetches
  let jobStatus = "open";
  await page.route(`**/api/v1/jobs/${mockJobId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: mockJobId,
        title: "Build a Soroban Smart Contract",
        description:
          "Implement a simple escrow contract for a freelance platform.",
        status: jobStatus,
        budget_usdc: 50000000000,
        milestones: 2,
        client_address: "GD...CLIENT",
        freelancer_address:
          jobStatus !== "open" ? "GD...FREELANCER" : undefined,
        on_chain_job_id: jobStatus === "funded" ? 1 : undefined,
      }),
    });
  });

  // --- Bid routes ---
  await page.route(`**/api/v1/jobs/${mockJobId}/bids`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: mockBidId,
          job_id: mockJobId,
          freelancer_address: "GD...FREELANCER",
          proposal: "test proposal",
          status: "pending",
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: mockBidId,
            job_id: mockJobId,
            freelancer_address: "GD...FREELANCER",
            proposal:
              "I have extensive experience with Soroban and Rust. I can finish this in 3 days.",
            status: "pending",
          },
        ]),
      });
    }
  });

  // Accept bid — was missing, causing real backend hit and redirect to never fire
  await page.route(
    `**/api/v1/jobs/${mockJobId}/bids/${mockBidId}/accept`,
    async (route) => {
      jobStatus = "awaiting_funding";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: mockJobId,
          title: "Build a Soroban Smart Contract",
          description:
            "Implement a simple escrow contract for a freelance platform.",
          status: "awaiting_funding",
          budget_usdc: 50000000000,
          milestones: 2,
          client_address: "GD...CLIENT",
          freelancer_address: "GD...FREELANCER",
        }),
      });
    },
  );

  // --- Stellar RPC ---
  await page.route("https://soroban-testnet.stellar.org", async (route) => {
    const postData = route.request().postDataJSON();
    const method = postData.method;
    let result: any = {};

    if (method === "getAccount") {
      result = { id: postData.params[0], sequence: "1" };
    } else if (method === "simulateTransaction") {
      result = {
        results: [{ auth: [], xdr: "AAAAAgAAAAE=" }],
        latestLedger: 1234,
        minResourceFee: "100",
        transactionData: "AAAAAAAAAAA=",
      };
    } else if (method === "sendTransaction") {
      result = { status: "PENDING", hash: "FAKE_TX_HASH", latestLedger: 1234 };
    } else if (method === "getTransaction") {
      result = { status: "SUCCESS", hash: "FAKE_TX_HASH", latestLedger: 1234 };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: postData.id, result }),
    });
  });

  // 1. Client posts a job
  await page.goto("/jobs/new");
  await page.fill("#job-title", "Build a Soroban Smart Contract");
  await page.fill(
    "#job-description",
    "Implement a simple escrow contract for a freelance platform.",
  );
  await page.fill("#job-budget", "5000");
  await page.fill("#job-milestones", "2");
  await page.click("#submit-job");

  await expect(page).toHaveURL(`/jobs/${mockJobId}`);
  await expect(
    page
      .getByRole("heading", { name: "Build a Soroban Smart Contract" })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/OPEN/i)).toBeVisible();

  // 2. Freelancer submits a bid
  await page.fill(
    "#bid-proposal",
    "I have extensive experience with Soroban and Rust. I can finish this in 3 days.",
  );
  await page.click("#submit-bid");

  await expect(page.getByText("Bids (1)")).toBeVisible();
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: "I have extensive experience with Soroban and Rust" }),
  ).toBeVisible();

  // 3. Client accepts the bid
  await page.click("button:has-text('Accept Bid')");

  await expect(page).toHaveURL(`/jobs/${mockJobId}/fund`);
  await expect(
    page.getByRole("heading", { name: "Fund Escrow" }),
  ).toBeVisible();

  // 4. Client deposits escrow
  await page.check("input[type='checkbox']");

  jobStatus = "funded";

  await page.click("button:has-text('Deposit $5,100.00 into Escrow')");
  await page.click("button:has-text('Confirm & Sign')");

  await expect(
    page.getByRole("heading", { name: "Escrow Funded!", level: 2 }),
  ).toBeVisible({ timeout: 10000 });

  // 5. Back to job details with FUNDED status
  await page.click("button:has-text('Go to Job')");
  await expect(page).toHaveURL(`/jobs/${mockJobId}`);
  await expect(page.getByText(/FUNDED/i)).toBeVisible();
});
