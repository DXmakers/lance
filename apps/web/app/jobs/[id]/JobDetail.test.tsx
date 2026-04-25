import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import JobDetailsPage from "./page";
import { useJobQuery } from "@/hooks/use-job-query";
import { useParams } from "next/navigation";

// Mock hooks
vi.mock("@/hooks/use-job-query");
vi.mock("next/navigation");
vi.mock("@/lib/store/use-wallet-store", () => ({
  useWalletStore: () => ({ address: "GD...CLIENT" }),
}));

interface JobQueryReturn {
  isLoading: boolean;
  data?: {
    job: unknown;
    bids: unknown[];
    milestones: unknown[];
    deliverables: unknown[];
    dispute: unknown;
  };
  mutations?: {
    createBid: { mutateAsync?: unknown; isPending: boolean };
    acceptBid?: { mutateAsync?: unknown; isPending: boolean };
  };
}

describe("JobDetailsPage", () => {
  const mockJob = {
    id: "test-job-id",
    title: "World Class Frontend",
    description: "Build a high-performance marketplace.",
    budget_usdc: 10000000,
    milestones: 3,
    client_address: "GD...CLIENT",
    freelancer_address: null,
    status: "open",
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.mocked(useParams).mockReturnValue({ id: "test-job-id" });
  });

  it("renders loading state", () => {
    vi.mocked(useJobQuery).mockReturnValue({
      isLoading: true,
    } as JobQueryReturn);

    render(<JobDetailsPage />);
    expect(screen.getByTestId("skeleton-loader")).toBeDefined();
  });

  it("renders job details correctly", async () => {
    vi.mocked(useJobQuery).mockReturnValue({
      isLoading: false,
      data: {
        job: mockJob,
        bids: [],
        milestones: [],
        deliverables: [],
        dispute: null,
      },
      mutations: {
        createBid: { isPending: false },
        acceptBid: { isPending: false },
      },
    } as JobQueryReturn);

    render(<JobDetailsPage />);
    expect(await screen.findByText("World Class Frontend")).toBeDefined();
    expect(await screen.findByText(/ID: test-job/i)).toBeDefined();
    expect(await screen.findByText("Budget (USDC)")).toBeDefined();
  });

  it("shows bid form for open jobs", async () => {
    vi.mocked(useJobQuery).mockReturnValue({
      isLoading: false,
      data: {
        job: mockJob,
        bids: [],
        milestones: [],
        deliverables: [],
        dispute: null,
      },
      mutations: {
        createBid: { isPending: false },
      },
    } as JobQueryReturn);

    render(<JobDetailsPage />);
    expect(await screen.findByPlaceholderText(/Outline your strategy/i)).toBeDefined();
    expect(await screen.findByText("Submit Proposal")).toBeDefined();
  });

  it("triggers bid submission", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useJobQuery).mockReturnValue({
      isLoading: false,
      data: {
        job: mockJob,
        bids: [],
        milestones: [],
        deliverables: [],
        dispute: null,
      },
      mutations: {
        createBid: { mutateAsync, isPending: false },
      },
    } as JobQueryReturn);

    render(<JobDetailsPage />);
    const textarea = await screen.findByPlaceholderText(/Outline your strategy/i);
    fireEvent.change(textarea, { target: { value: "I am the best candidate for this job because I have extensive experience in Web3 and I am very motivated." } });
    
    const submitBtn = await screen.findByText("Submit Proposal");
    fireEvent.submit(submitBtn.closest('form')!);

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalled(), { timeout: 2000 });
  });
});
