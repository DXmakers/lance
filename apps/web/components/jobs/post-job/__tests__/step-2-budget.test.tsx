import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Step2Budget } from "../step-2-budget";

describe("Step2Budget", () => {
  const defaultProps = {
    budget: 1000,
    setBudget: () => {},
    milestones: 1,
    setMilestones: () => {},
    estimatedCompletionDate: "2026-05-15",
    setEstimatedCompletionDate: () => {},
    estimatedDurationDays: "14",
    setEstimatedDurationDays: () => {},
    memo: "",
    setMemo: () => {},
  };

  it("renders all budget and timeline fields", () => {
    render(<Step2Budget {...defaultProps} />);

    expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/number of milestones/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/estimated completion date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target duration \(days\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/internal memo/i)).toBeInTheDocument();
  });

  it("displays current values correctly", () => {
    render(
      <Step2Budget
        {...defaultProps}
        budget={2500}
        milestones={3}
        estimatedDurationDays="21"
        memo="Internal note"
      />
    );

    expect(screen.getByLabelText(/budget \(usdc\)/i)).toHaveValue(2500);
    expect(screen.getByLabelText(/number of milestones/i)).toHaveValue(3);
    expect(screen.getByLabelText(/target duration \(days\)/i)).toHaveValue(21);
    expect(screen.getByLabelText(/internal memo/i)).toHaveValue("Internal note");
  });

  it("calls setBudget when budget changes", () => {
    const setBudget = vi.fn();
    render(<Step2Budget {...defaultProps} setBudget={setBudget} />);

    fireEvent.change(screen.getByLabelText(/budget \(usdc\)/i), {
      target: { value: "2000" },
    });

    expect(setBudget).toHaveBeenCalledWith(2000);
  });

  it("shows error messages when provided", () => {
    render(
      <Step2Budget
        {...defaultProps}
        budgetError="Budget must be at least 100"
        milestonesError="At least one milestone required"
      />
    );

    expect(screen.getByText("Budget must be at least 100")).toBeInTheDocument();
    expect(screen.getByText("At least one milestone required")).toBeInTheDocument();
  });

  it("disables all fields when disabled prop is true", () => {
    render(<Step2Budget {...defaultProps} disabled={true} />);

    expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeDisabled();
    expect(screen.getByLabelText(/number of milestones/i)).toBeDisabled();
    expect(screen.getByLabelText(/estimated completion date/i)).toBeDisabled();
    expect(screen.getByLabelText(/target duration \(days\)/i)).toBeDisabled();
    expect(screen.getByLabelText(/internal memo/i)).toBeDisabled();
  });

  it("shows character count for memo", () => {
    render(<Step2Budget {...defaultProps} memo="Some note" />);

    expect(screen.getByText("11/100 characters")).toBeInTheDocument();
  });
});
