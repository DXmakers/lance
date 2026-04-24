import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SubmitBidModal, submitBidSchema } from "../submit-bid-modal";

const createBidMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    bids: {
      create: (...args: unknown[]) => createBidMock(...args),
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const onSubmitted = vi.fn().mockResolvedValue(undefined);
  const resolveFreelancerAddress = vi.fn().mockResolvedValue("GABC123");

  render(
    <QueryClientProvider client={client}>
      <SubmitBidModal
        jobId="job-123"
        onSubmitted={onSubmitted}
        resolveFreelancerAddress={resolveFreelancerAddress}
      />
    </QueryClientProvider>,
  );

  return { onSubmitted, resolveFreelancerAddress };
}

describe("submitBidSchema", () => {
  it("rejects proposal shorter than 24 chars", () => {
    const parsed = submitBidSchema.safeParse({ proposal: "too short" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid proposal", () => {
    const parsed = submitBidSchema.safeParse({
      proposal: "I will ship this in milestones with weekly check-ins.",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("SubmitBidModal", () => {
  beforeEach(() => {
    createBidMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("shows validation feedback and disables submission until valid", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));

    const textarea = screen.getByLabelText("Proposal");
    fireEvent.change(textarea, { target: { value: "short" } });

    expect(screen.getByText(/at least 24 characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Bid" })).toBeDisabled();
  });

  it("submits bid and closes modal on success", async () => {
    createBidMock.mockResolvedValue({ id: "bid-1" });
    const { onSubmitted, resolveFreelancerAddress } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));
    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send Bid" }));

    await waitFor(() => {
      expect(resolveFreelancerAddress).toHaveBeenCalledTimes(1);
      expect(createBidMock).toHaveBeenCalledWith("job-123", {
        freelancer_address: "GABC123",
        proposal:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      });
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(toastSuccessMock).toHaveBeenCalled();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows API failure message", async () => {
    createBidMock.mockRejectedValue(new Error("backend failed"));
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));
    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value: "This is a complete proposal that satisfies validation constraints.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send Bid" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: "backend failed" }),
      );
    });
  });
});
