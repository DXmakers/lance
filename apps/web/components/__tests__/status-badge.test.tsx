import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusBadge } from "../jobs/status-badge";

describe("StatusBadge Component", () => {
  it("renders pending status properly with default label", () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText(/Pending/i);
    expect(badge).toBeInTheDocument();
    expect(badge.closest("div")).toHaveClass("text-amber-500");
  });

  it("renders success status properly with custom label", () => {
    render(<StatusBadge status="success" label="Approved" />);
    const badge = screen.getByText(/Approved/i);
    expect(badge).toBeInTheDocument();
    expect(badge.closest("div")).toHaveClass("text-emerald-500");
  });

  it("renders failed status correctly", () => {
    render(<StatusBadge status="failed" />);
    const badge = screen.getByText(/Failed/i);
    expect(badge).toBeInTheDocument();
    expect(badge.closest("div")).toHaveClass("text-red-500");
  });
});
