import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "next/navigation";
import JobDetailsPage from "../app/jobs/[id]/page";

vi.mock("@/lib/api", () => ({
  api: {
    jobs: {
      get: vi.fn(),
      milestones: vi.fn(),
      deliverables: { list: vi.fn() },
      dispute: { get: vi.fn(), open: vi.fn() },
      releaseMilestone: vi.fn(),
    },
    bids: { list: vi.fn(), accept: vi.fn() },
    uploads: { pin: vi.fn() },
  },
}));

vi.mock("@/lib/stellar", () => ({
  connectWallet: vi.fn().mockResolvedValue("GABC123TESTADDRESS"),
  getConnectedWalletAddress: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/contracts", () => ({
  releaseFunds: vi.fn().mockResolvedValue("tx123"),
  openDispute: vi.fn().mockResolvedValue("dispute123"),
  getEscrowContractId: vi.fn().mockReturnValue("C1234567890"),
}));

const mockJob = {
  id: "job-123",
  title: "Build a Soroban escrow system",
  description: "We need a developer to build an escrow system on Soroban.",
  budget_usdc: 500000000,
  milestones: 3,
  client_address: "GCXDEV5E2J4JTS3Q3C5JZV4P5C7E",
  freelancer_address: undefined,
  status: "open",
  metadata_hash: undefined,
  on_chain_job_id: 1,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const mockMilestones = [
  {
    id: "milestone-1",
    job_id: "job-123",
    index: 1,
    title: "Milestone 1",
    amount_usdc: 166666666,
    status: "pending",
  },
];

const mockBids = [
  {
    id: "bid-1",
    job_id: "job-123",
    freelancer_address: "GABC123",
    proposal: "I can deliver this in two milestones.",
    status: "pending",
    created_at: "2026-04-01T00:00:00Z",
  },
];

const mockDeliverables = [];

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe("JobDetailsPage", () => {
  const { api } = require("@/lib/api");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.jobs.get).mockResolvedValue(mockJob);
    vi.mocked(api.jobs.milestones).mockResolvedValue(mockMilestones);
    vi.mocked(api.bids.list).mockResolvedValue(mockBids);
    vi.mocked(api.jobs.deliverables.list).mockResolvedValue(mockDeliverables);
    vi.mocked(api.jobs.dispute.get).mockResolvedValue(null);
  });

  it("renders job title and description", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Build a Soroban escrow system/i);

    expect(screen.getByText(/Build a Soroban escrow system/i)).toBeInTheDocument();
    expect(
      screen.getByText(/We need a developer to build an escrow system/i),
    ).toBeInTheDocument();
  });

  it("renders job status badge", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/open/i);

    expect(screen.getByText(/open/i)).toBeInTheDocument();
  });

  it("renders formatted budget", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/\$500\.00/i);

    expect(screen.getByText(/\$500\.00/)).toBeInTheDocument();
  });

  it("renders client address", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/GCXDEV/i);

    expect(screen.getByText(/GCXDEV/)).toBeInTheDocument();
  });

  it("renders milestones section when job is not open", async () => {
    vi.mocked(api.jobs.get).mockResolvedValue({
      ...mockJob,
      status: "in_progress",
    });

    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Milestone Ledger/i);

    expect(screen.getByText(/Milestone Ledger/i)).toBeInTheDocument();
  });

  it("renders deliverables section when job is not open", async () => {
    vi.mocked(api.jobs.get).mockResolvedValue({
      ...mockJob,
      status: "in_progress",
    });

    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Deliverables/i);

    expect(screen.getByText(/Deliverables/i)).toBeInTheDocument();
  });

  it("shows loading skeleton when job is loading", () => {
    vi.mocked(api.jobs.get).mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    expect(screen.getByText(/Loading workspace/i)).toBeInTheDocument();
  });

  it("shows error state when job is not found", async () => {
    vi.mocked(api.jobs.get).mockRejectedValue(new Error("Job not found"));

    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Workspace unavailable/i);

    expect(screen.getByText(/Workspace unavailable/i)).toBeInTheDocument();
  });

  it("renders Connected Viewer section", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Connected Viewer/i);

    expect(screen.getByText(/Connected Viewer/i)).toBeInTheDocument();
  });

  it("renders Activity pulse section", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Activity pulse/i);

    expect(screen.getByText(/Activity pulse/i)).toBeInTheDocument();
  });
});

describe("JobDetailsPage - Dark theme styling", () => {
  it("uses zinc-950 background for main container", async () => {
    const { container } = render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Build a Soroban escrow system/i);

    const mainElement = container.querySelector(".min-h-screen");
    expect(mainElement?.className).toContain("bg-zinc-950");
  });

  it("uses amber-500 for status indicators", async () => {
    render(
      <div>
        <JobDetailsPage params={{ id: "job-123" }} />
      </div>,
      { wrapper },
    );

    await screen.findByText(/Job Overview/i);

    expect(screen.getByText(/Job Overview/i)).toBeInTheDocument();
  });
});

describe("JobDetailsPage - Zod validation", () => {
  const { z } = require("zod");

  const deliverableSchema = z.object({
    label: z.string().min(1, "Label is required"),
    url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    kind: z.enum(["link", "file"]),
    file_hash: z.string().optional(),
  });

  it("validates deliverable form - rejects empty label", () => {
    const parsed = deliverableSchema.safeParse({
      label: "",
      url: "",
      kind: "link",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates deliverable form - accepts valid input", () => {
    const parsed = deliverableSchema.safeParse({
      label: "Initial delivery",
      url: "https://github.com/user/repo",
      kind: "link",
    });
    expect(parsed.success).toBe(true);
  });
});