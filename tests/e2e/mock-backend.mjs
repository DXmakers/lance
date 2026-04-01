import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.PORT || "3001");

const seededDisputeId = "11111111-1111-4111-8111-111111111111";
const seededJobId = "22222222-2222-4222-8222-222222222222";

const timestamp = () => new Date().toISOString();

const jobs = [
  {
    id: seededJobId,
    title: "Escrow release audit",
    description:
      "Validate dispute and milestone release logic for a Testnet deployment.",
    budget_usdc: 2_750_000_000,
    milestones: 2,
    client_address: "GCLIENTSEEDEDPUBLICKEY1234567890ABCDE",
    freelancer_address: "GFREELANCERSEEDEDPUBLICKEY123456789",
    status: "in_progress",
    metadata_hash: null,
    created_at: timestamp(),
    updated_at: timestamp(),
  },
];

const disputes = new Map([
  [
    seededDisputeId,
    {
      id: seededDisputeId,
      job_id: seededJobId,
      opened_by: "GFREELANCERSEEDEDPUBLICKEY123456789",
      status: "open",
      created_at: timestamp(),
    },
  ],
]);

const verdicts = new Map([
  [
    seededDisputeId,
    {
      id: "33333333-3333-4333-8333-333333333333",
      dispute_id: seededDisputeId,
      winner: "freelancer",
      freelancer_share_bps: 8500,
      reasoning:
        "Evidence indicates the milestone deliverables were shipped and materially accepted before the dispute.",
      on_chain_tx: "mock-verdict-tx-0001",
      created_at: timestamp(),
    },
  ],
]);

const evidenceRecords = [];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method === "OPTIONS") {
    return sendJson(res, 200, {});
  }

  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname.replace(/^\/api\/v1/, "/api");

  if (req.method === "GET" && path === "/api/jobs") {
    return sendJson(res, 200, jobs);
  }

  if (req.method === "POST" && path === "/api/jobs") {
    const body = await readBody(req);
    const job = {
      id: randomUUID(),
      title: body.title,
      description: body.description,
      budget_usdc: body.budget_usdc,
      milestones: body.milestones,
      client_address: body.client_address,
      freelancer_address: null,
      status: "open",
      metadata_hash: null,
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    jobs.unshift(job);
    return sendJson(res, 200, job);
  }

  const disputeMatch = path.match(/^\/api\/disputes\/([^/]+)$/);
  if (req.method === "GET" && disputeMatch) {
    const dispute = disputes.get(disputeMatch[1]);
    return dispute
      ? sendJson(res, 200, dispute)
      : sendJson(res, 404, { error: "Dispute not found" });
  }

  const verdictMatch = path.match(/^\/api\/disputes\/([^/]+)\/verdict$/);
  if (req.method === "GET" && verdictMatch) {
    const verdict = verdicts.get(verdictMatch[1]);
    return verdict
      ? sendJson(res, 200, verdict)
      : sendJson(res, 404, { error: "Verdict not found" });
  }

  const evidenceMatch = path.match(/^\/api\/disputes\/([^/]+)\/evidence$/);
  if (req.method === "POST" && evidenceMatch) {
    const body = await readBody(req);
    const evidence = {
      id: randomUUID(),
      dispute_id: evidenceMatch[1],
      submitted_by: body.submitted_by,
      content: body.content,
      file_hash: body.file_hash ?? null,
      created_at: timestamp(),
    };
    evidenceRecords.push(evidence);
    return sendJson(res, 200, evidence);
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock backend listening on http://127.0.0.1:${port}`);
});
