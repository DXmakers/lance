import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCard } from "./JobCard";
import { BoardJob } from "@/hooks/job-queries";

const mockJob: BoardJob = {
  id: "1",
  title: "Test Job",
  description: "This is a test job description that should be clamped.",
  budget_usdc: 1000 * 10_000_000,
  milestones: 2,
  client_address: "GABC123",
  status: "open",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ["react", "web3"],
  deadlineAt: new Date().toISOString(),
  clientReputation: {
    scoreBps: 8000,
    totalJobs: 10,
    totalPoints: 50,
    reviews: 5,
    starRating: 4.5,
    averageStars: 4.5,
  },
};

describe("JobCard", () => {
  it("renders job title and description", () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText("Test Job")).toBeDefined();
    expect(screen.getByText(/test job description/)).toBeDefined();
  });

  it("displays correct status color for open jobs", () => {
    render(<JobCard job={mockJob} />);
    const status = screen.getByText("open");
    expect(status.className).toContain("text-emerald-500");
  });

  it("renders tags correctly", () => {
    render(<JobCard job={mockJob} />);
    expect(screen.getByText("react")).toBeDefined();
    expect(screen.getByText("web3")).toBeDefined();
  });

  it("formats budget correctly", () => {
    render(<JobCard job={mockJob} />);
    // formatUsdc(1000 * 10_000_000) -> 1,000.00
    expect(screen.getByText(/1,000/)).toBeDefined();
  });

  it("links to the correct job detail page", () => {
    render(<JobCard job={mockJob} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/jobs/1");
  });
});
