/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobCard } from "./job-card";
import { useSavedJobsStore } from "@/lib/store/use-saved-jobs-store";

// Mock the store
vi.mock("@/lib/store/use-saved-jobs-store", () => ({
  useSavedJobsStore: vi.fn(),
}));

// Mock the Stars component
vi.mock("@/components/stars", () => ({
  Stars: () => <div data-testid="stars-mock" />,
}));

const mockJob = {
  id: "job-1",
  title: "Test Job",
  description: "Test Description",
  budget_usdc: 1000 * 10_000_000,
  milestones: 3,
  client_address: "GXXXXX",
  status: "open",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ["react", "stellar"],
  deadlineAt: new Date().toISOString(),
  clientReputation: {
    scoreBps: 8000,
    totalJobs: 10,
    totalPoints: 100,
    reviews: 5,
    starRating: 4.5,
    averageStars: 4.5,
  },
};

describe("JobCard", () => {
  it("renders job details correctly", () => {
    (useSavedJobsStore as any).mockReturnValue({
      toggleSaveJob: vi.fn(),
      isSaved: vi.fn().mockReturnValue(false),
    });

    render(<JobCard job={mockJob as any} />);

    expect(screen.getByText("Test Job")).toBeDefined();
    expect(screen.getByText("1,000 USDC")).toBeDefined();
    expect(screen.getByText("react")).toBeDefined();
  });

  it("calls toggleSaveJob when bookmark button is clicked", () => {
    const toggleSaveJob = vi.fn();
    (useSavedJobsStore as any).mockReturnValue({
      toggleSaveJob,
      isSaved: vi.fn().mockReturnValue(false),
    });

    render(<JobCard job={mockJob as any} />);

    const bookmarkButton = screen.getByLabelText("Save job");
    fireEvent.click(bookmarkButton);

    expect(toggleSaveJob).toHaveBeenCalledWith(mockJob);
  });
});
