import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubmitBidModal, submitBidSchema } from "../submit-bid-modal";

const submitMock = vi.fn();
const resetMock = vi.fn();
const useSubmitBidMock = vi.fn();

vi.mock("@/hooks/use-submit-bid", () => ({
  useSubmitBid: () => useSubmitBidMock(),
}));

function buildTransactionState(overrides: Record<string, unknown> = {}) {
  return {
    step: "idle",
    isPending: false,
    txHash: null,
    message: "Ready.",
    error: null,
    simulationLog: null,
    unsignedXdr: null,
    signedXdr: null,
    progressHistory: [],
    execute: vi.fn(),
    reset: resetMock,
    ...overrides,
  };
}

function renderModal(onChainJobId = 42n) {
  const onSubmitted = vi.fn().mockResolvedValue(undefined);

  render(
    <SubmitBidModal
      jobId="job-123"
      onChainJobId={onChainJobId}
      onSubmitted={onSubmitted}
    />,
  );

  return { onSubmitted };
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
    vi.useRealTimers();
    submitMock.mockReset();
    resetMock.mockReset();
    useSubmitBidMock.mockReturnValue({
      submit: submitMock,
      isSubmitting: false,
      transaction: buildTransactionState(),
    });
  });

  it("shows validation feedback and disables submission until valid", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));

    const textarea = screen.getByLabelText("Proposal");
    fireEvent.change(textarea, { target: { value: "short" } });

    expect(screen.getByText(/at least 24 characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign & Submit Bid" })).toBeDisabled();
  });

  it("prevents wallet submission until the job has an on-chain id", () => {
    renderModal(0n);

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));
    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      },
    });

    expect(screen.getByText(/not been indexed on-chain yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign & Submit Bid" })).toBeDisabled();
  });

  it("submits bid and refreshes the job immediately on success", async () => {
    submitMock.mockResolvedValue({ bid: { id: "bid-1" }, txHash: "tx-1" });
    const { onSubmitted } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));
    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign & Submit Bid" }));

    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledWith({
        jobId: "job-123",
        onChainJobId: 42n,
        proposal:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      });
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the pipeline when the transaction has started", () => {
    useSubmitBidMock.mockReturnValue({
      submit: submitMock,
      isSubmitting: true,
      transaction: buildTransactionState({
        step: "simulating",
        isPending: true,
        message: "Simulation complete. Resources and fees assembled.",
        simulationLog: {
          baseFee: "100",
          resourceFee: "5000",
          estimatedTotalFee: "5100",
          cpuInsns: "12",
          memBytes: "128",
          readBytes: 64,
          writeBytes: 32,
        },
      }),
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Submit Bid" }));

    expect(screen.getByText("Transaction Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Fee Breakdown")).toBeInTheDocument();
    expect(screen.getByText(/estimated total/i)).toBeInTheDocument();
  });
});
