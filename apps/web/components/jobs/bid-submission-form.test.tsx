import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BidSubmissionForm } from "./bid-submission-form";

const submitMock = vi.fn();
const useSubmitBidMock = vi.fn();

vi.mock("@/hooks/use-submit-bid", () => ({
  useSubmitBid: () => useSubmitBidMock(),
}));

function buildTransactionState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    step: "idle",
    isPending: false,
    txHash: null,
    message: "Ready.",
    error: null,
    unsignedXdr: null,
    signedXdr: null,
    simulationLog: null,
    execute: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function renderForm(onChainJobId = 42n) {
  const onSubmitted = vi.fn().mockResolvedValue(undefined);

  render(
    <BidSubmissionForm jobId="job-123" onChainJobId={onChainJobId} onSubmitted={onSubmitted} />,
  );

  return { onSubmitted };
}

describe("BidSubmissionForm", () => {
  beforeEach(() => {
    submitMock.mockReset();
    useSubmitBidMock.mockReset();
    useSubmitBidMock.mockReturnValue({
      submit: submitMock,
      isSubmitting: false,
      transaction: buildTransactionState(),
    });
  });

  it("shows validation feedback and disables submit for an invalid proposal", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: { value: "short" },
    });

    expect(screen.getByText(/at least 24 characters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign & submit bid/i })).toBeDisabled();
  });

  it("disables submission and shows pending indexer notice when on-chain job id is not ready", () => {
    renderForm(0n);

    expect(screen.getByText(/not been indexed on-chain yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign & submit bid/i })).toBeDisabled();
  });

  it("submits a valid proposal and calls onSubmitted after success", async () => {
    submitMock.mockResolvedValue({ bid: { id: "bid-1" }, txHash: "tx-1" });
    const { onSubmitted } = renderForm();

    fireEvent.change(screen.getByLabelText("Proposal"), {
      target: {
        value:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /sign & submit bid/i }));

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

  it("shows transaction errors when present", () => {
    useSubmitBidMock.mockReturnValue({
      submit: submitMock,
      isSubmitting: false,
      transaction: buildTransactionState({
        step: "signing",
        isPending: false,
        error: "Wallet rejected the transaction.",
      }),
    });

    renderForm();

    expect(screen.getByText(/wallet rejected the transaction/i)).toBeInTheDocument();
  });

  it("renders the loading label when submission is pending", () => {
    useSubmitBidMock.mockReturnValue({
      submit: submitMock,
      isSubmitting: true,
      transaction: buildTransactionState({
        step: "building",
        isPending: true,
      }),
    });

    renderForm();

    expect(screen.getByRole("button", { name: /preparing/i })).toBeDisabled();
  });

  it("clears the proposal when the Clear button is pressed", () => {
    renderForm();

    const textarea = screen.getByLabelText("Proposal");
    fireEvent.change(textarea, {
      target: {
        value:
          "I can deliver this in two milestones with contract-safe updates and daily standups.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(textarea).toHaveValue("");
  });
});
