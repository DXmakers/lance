import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useJob, useJobMilestones, useJobBids, useJobDeliverables } from "../use-job";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      jobs: {
        get: vi.fn(),
        list: vi.fn(),
        create: vi.fn(),
        markFunded: vi.fn(),
        milestones: vi.fn(),
        releaseMilestone: vi.fn(),
        deliverables: {
          list: vi.fn(),
          submit: vi.fn(),
        },
        dispute: {
          get: vi.fn(),
          open: vi.fn(),
        },
      },
      bids: {
        list: vi.fn(),
        create: vi.fn(),
        accept: vi.fn(),
      },
    },
  };
});

const createMockJob = () => ({
  id: "job-123",
  title: "Build a Soroban escrow system",
  description: "We need a developer to build an escrow system on Soroban.",
  budget_usdc: 500000000,
  milestones: 3,
  client_address: "GCXDEV5E2J4JTS3Q3C5JZV4P5C7E",
  freelancer_address: undefined,
  status: "open",
  metadata_hash: undefined,
  on_chain_job_id: undefined,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
});

const createMockMilestones = () => [
  {
    id: "milestone-1",
    job_id: "job-123",
    index: 1,
    title: "Milestone 1",
    amount_usdc: 166666666,
    status: "pending",
  },
  {
    id: "milestone-2",
    job_id: "job-123",
    index: 2,
    title: "Milestone 2",
    amount_usdc: 166666667,
    status: "pending",
  },
  {
    id: "milestone-3",
    job_id: "job-123",
    index: 3,
    title: "Milestone 3",
    amount_usdc: 166666667,
    status: "pending",
  },
];

const createMockBids = () => [
  {
    id: "bid-1",
    job_id: "job-123",
    freelancer_address: "GABC123",
    proposal: "I can deliver this in two milestones.",
    status: "pending",
    created_at: "2026-04-01T00:00:00Z",
  },
];

const createMockDeliverables = () => [
  {
    id: "deliverable-1",
    job_id: "job-123",
    milestone_index: 1,
    submitted_by: "GABC123",
    label: "Initial delivery",
    kind: "link",
    url: "https://github.com/example",
    created_at: "2026-04-01T00:00:00Z",
  },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches job by id", async () => {
    const mockJob = createMockJob();
    vi.mocked(api.api.jobs.get).mockResolvedValueOnce(mockJob);

    const { result } = renderHook(() => useJob("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockJob);
    expect(api.api.jobs.get).toHaveBeenCalledWith("job-123");
  });

  it("returns error when job not found", async () => {
    vi.mocked(api.api.jobs.get).mockRejectedValueOnce(new Error("Job not found"));

    const { result } = renderHook(() => useJob("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
  });

  it("does not fetch when id is empty", async () => {
    const { result } = renderHook(() => useJob(""), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(api.api.jobs.get).not.toHaveBeenCalled();
  });
});

describe("useJobMilestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches milestones for a job", async () => {
    const mockMilestones = createMockMilestones();
    vi.mocked(api.api.jobs.milestones).mockResolvedValueOnce(mockMilestones);

    const { result } = renderHook(() => useJobMilestones("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockMilestones);
  });

  it("handles missing milestones gracefully", async () => {
    vi.mocked(api.api.jobs.milestones).mockRejectedValueOnce(new Error("Not found"));

    const { result } = renderHook(() => useJobMilestones("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useJobBids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches bids for a job", async () => {
    const mockBids = createMockBids();
    vi.mocked(api.api.bids.list).mockResolvedValueOnce(mockBids);

    const { result } = renderHook(() => useJobBids("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockBids);
  });
});

describe("useJobDeliverables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches deliverables for a job", async () => {
    const mockDeliverables = createMockDeliverables();
    vi.mocked(api.api.jobs.deliverables.list).mockResolvedValueOnce(mockDeliverables);

    const { result } = renderHook(() => useJobDeliverables("job-123"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockDeliverables);
  });
});

describe("Zod validation - deliverable schema", () => {
  const { z } = require("zod");

  const deliverableSchema = z.object({
    label: z.string().min(1, "Label is required"),
    url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    kind: z.enum(["link", "file"]),
    file_hash: z.string().optional(),
  });

  it("rejects empty label", () => {
    const parsed = deliverableSchema.safeParse({
      label: "",
      url: "https://example.com",
      kind: "link",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts valid deliverable with link", () => {
    const parsed = deliverableSchema.safeParse({
      label: "Initial delivery",
      url: "https://example.com",
      kind: "link",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid deliverable with file", () => {
    const parsed = deliverableSchema.safeParse({
      label: "File delivery",
      kind: "file",
      file_hash: "abc123",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const parsed = deliverableSchema.safeParse({
      label: "Test",
      url: "not-a-url",
      kind: "link",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid kind", () => {
    const parsed = deliverableSchema.safeParse({
      label: "Test",
      kind: "invalid",
    });
    expect(parsed.success).toBe(false);
  });
});