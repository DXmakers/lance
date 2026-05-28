import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepIndicator } from "../step-indicator";

describe("StepIndicator", () => {
  it("renders all step labels", () => {
    render(
      <StepIndicator
        currentStep={1}
        steps={[
          { label: "Scope", description: "Details" },
          { label: "Budget", description: "Pricing" },
          { label: "Review", description: "Confirm" },
        ]}
      />
    );

    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows checkmark for completed steps", () => {
    render(
      <StepIndicator
        currentStep={2}
        steps={[
          { label: "One" },
          { label: "Two" },
          { label: "Three" },
        ]}
      />
    );

    const checkmarks = screen.getAllByText("✓");
    expect(checkmarks).toHaveLength(1); // Step 1 is completed
  });

  it("highlights current step with amber color", () => {
    render(
      <StepIndicator
        currentStep={2}
        steps={[
          { label: "One" },
          { label: "Two" },
          { label: "Three" },
        ]}
      />
    );

    const currentIndicator = screen.getByText("2");
    expect(currentIndicator).toHaveClass("text-amber-300");
  });

  it("applies correct styles for completed steps (emerald)", () => {
    render(
      <StepIndicator
        currentStep={3}
        steps={[
          { label: "One" },
          { label: "Two" },
          { label: "Three" },
        ]}
      />
    );

    const completedIndicators = screen.getAllByText("✓");
    expect(completedIndicators[0]).toHaveClass("text-emerald-400");
  });

  it("has proper accessibility role and labels", () => {
    render(
      <StepIndicator
        currentStep={1}
        steps={[
          { label: "Scope" },
          { label: "Budget" },
          { label: "Review" },
        ]}
      />
    );

    expect(screen.getByRole("navigation")).toHaveAttribute("aria-label", "Job creation progress");
  });

  it("shows step numbers correctly for incomplete steps", () => {
    render(
      <StepIndicator
        currentStep={1}
        steps={[
          { label: "Scope" },
          { label: "Budget" },
          { label: "Review" },
        ]}
      />
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
