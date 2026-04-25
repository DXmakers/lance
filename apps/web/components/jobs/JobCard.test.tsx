import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { JobCard } from "./JobCard";
import { BoardJob } from "@/hooks/job-queries";

const mockJob: BoardJob = {
  id: "1",
  title: "Test Job",
  description: "This is a test job description that should be clamped.",
  budget: 1000 * 10_000_000,
  employerAddress: "GABC123",
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
  it("renders job title and description", async () => {
    const { findByText } = render(<JobCard job={mockJob} />);
    expect(await findByText("Test Job")).toBeDefined();
    expect(await findByText(/test job description/)).toBeDefined();
  });

  it("displays correct status color and aria-label for open jobs", async () => {
    const { findByLabelText } = render(<JobCard job={mockJob} />);
    const status = await findByLabelText(/Job status: open/i);
    expect(status.className).toContain("text-emerald-500");
  });

  it("renders tags with sufficient contrast", async () => {
    const { findByText } = render(<JobCard job={mockJob} />);
    const tag = await findByText("react");
    expect(tag.className).toContain("text-zinc-400"); // Verified improved contrast
  });

  it("formats budget correctly", async () => {
    const { findByText } = render(<JobCard job={mockJob} />);
    expect(await findByText(/1,000/)).toBeDefined();
  });

  it("links to the correct job detail page", async () => {
    const { findByRole } = render(<JobCard job={mockJob} />);
    const link = await findByRole("link");
    expect(link.getAttribute("href")).toBe("/jobs/1");
  });
});
