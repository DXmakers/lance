import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BidCard } from "../jobs/bid-card";

describe("BidCard Component", () => {
  const defaultProps = {
    bidId: "b-01",
    freelancerName: "Satoshi Nakamoto",
    bidAmount: 1500,
    currency: "USDC",
    deliveryTimeDays: 7,
    status: "pending" as const,
    proposalPreview: "I can deliver this smart contract perfectly.",
  };

  it("renders correctly with formatted bid amount", () => {
    render(<BidCard {...defaultProps} />);
    expect(screen.getByText("Satoshi Nakamoto")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("I can deliver this smart contract perfectly.")).toBeInTheDocument();
  });

  it("calls onAccept correctly", () => {
    const handleAccept = vi.fn();
    render(<BidCard {...defaultProps} onAccept={handleAccept} />);
    const acceptBtn = screen.getByRole("button", { name: /accept bid/i });
    fireEvent.click(acceptBtn);
    expect(handleAccept).toHaveBeenCalledWith("b-01");
  });

  it("calls onReject correctly", () => {
    const handleReject = vi.fn();
    render(<BidCard {...defaultProps} onReject={handleReject} />);
    const declineBtn = screen.getByRole("button", { name: /decline/i });
    fireEvent.click(declineBtn);
    expect(handleReject).toHaveBeenCalledWith("b-01");
  });

  it("hides action buttons when status is not pending", () => {
    render(<BidCard {...defaultProps} status="success" />);
    expect(screen.queryByRole("button", { name: /accept bid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /decline/i })).not.toBeInTheDocument();
  });
});
