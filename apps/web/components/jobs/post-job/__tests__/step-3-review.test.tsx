import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Step3Review } from "../step-3-review";

// Mock transaction tracker
vi.mock("@/components/transaction/transaction-tracker", () => ({
  TransactionTracker: () => <div>TransactionTracker</div>,
}));

describe("Step3Review", () => {
  const defaultProps = {
    reviewItems: [
      { label: "Title", value: "Test Job" },
      { label: "Budget", value: "1000 USDC" },
    ],
    isSubmitting: false,
    txStep: "idle",
  };

  it("renders review items correctly", () => {
    render(<Step3Review {...defaultProps} />);

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Test Job")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("1000 USDC")).toBeInTheDocument();
  });

  it("shows IPFS ready badge", () => {
    render(<Step3Review {...defaultProps} />);

    expect(screen.getByText("IPFS Ready")).toBeInTheDocument();
  });

  it("renders TransactionTracker component", () => {
    render(<Step3Review {...defaultProps} />);

    expect(screen.getByText("TransactionTracker")).toBeInTheDocument();
  });

  it("shows processing indicator when submitting", () => {
    render(<Step3Review {...defaultProps} isSubmitting={true} txStep="signing" />);

    expect(screen.getByText(/waiting for wallet signature/i)).toBeInTheDocument();
  });

  it("displays correct processing message for different tx steps", () => {
    const { rerender } = render(<Step3Review {...defaultProps} isSubmitting={true} txStep="building" />);
    expect(screen.getByText(/building transaction/i)).toBeInTheDocument();

    rerender(<Step3Review {...defaultProps} isSubmitting={true} txStep="simulating" />);
    expect(screen.getByText(/simulating transaction/i)).toBeInTheDocument();

    rerender(<Step3Review {...defaultProps} isSubmitting={true} txStep="submitting" />);
    expect(screen.getByText(/submitting to network/i)).toBeInTheDocument();

    rerender(<Step3Review {...defaultProps} isSubmitting={true} txStep="confirming" />);
    expect(screen.getByText(/confirming on-chain/i)).toBeInTheDocument();
  });

  it("has proper accessibility landmark", () => {
    render(<Step3Review {...defaultProps} />);

    expect(screen.getByRole("region")).toHaveAttribute("aria-labelledby", "review-heading");
  });
});
