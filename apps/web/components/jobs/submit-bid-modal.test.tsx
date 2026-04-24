import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { api } from "@/lib/api";
import { getConnectedWalletAddress } from "@/lib/stellar";

vi.mock("@/lib/api", () => ({
  api: {
    bids: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/stellar", () => ({
  getConnectedWalletAddress: vi.fn(),
}));

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const onSubmitted = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <SubmitBidModal jobId="job-1" onSubmitted={onSubmitted} />
    </QueryClientProvider>,
  );

  return { onSubmitted };
}

describe("SubmitBidModal", () => {
  beforeEach(() => {
    vi.mocked(getConnectedWalletAddress).mockResolvedValue("GDWALLET123");
    vi.mocked(api.bids.create).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows inline validation feedback and blocks invalid submit", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Bid" }));

    expect(
      await screen.findByText("Proposal must be at least 80 characters."),
    ).toBeInTheDocument();
    expect(vi.mocked(api.bids.create)).not.toHaveBeenCalled();
  });

  it("submits a valid bid and closes modal", async () => {
    const { onSubmitted } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));

    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value:
          "I can deliver this job with a production-ready React workflow, strong accessibility, and milestone-based QA signoff.",
      },
    });

    fireEvent.change(screen.getByLabelText("Timeline (days)"), {
      target: { value: "15" },
    });

    fireEvent.change(screen.getByLabelText("Milestone summary"), {
      target: {
        value: "Week 1 design system, week 2 implementation, final QA and handoff.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Bid" }));

    await waitFor(() => {
      expect(vi.mocked(api.bids.create)).toHaveBeenCalledTimes(1);
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
