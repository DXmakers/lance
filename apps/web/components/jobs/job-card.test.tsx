/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobCard } from "./job-card";
import { useSavedJobsStore } from "@/lib/store/use-saved-jobs-store";
import type { BoardJob } from "@/hooks/use-job-board";

// Mock the store
vi.mock("@/lib/store/use-saved-jobs-store", () => ({
  useSavedJobsStore: vi.fn(),
}));

// Mock the Stars component
vi.mock("@/components/stars", () => ({
  Stars: () => <div data-testid="stars-mock" />,
}));

type SavedJobsStoreState = ReturnType<typeof useSavedJobsStore>;

const mockJob: BoardJob = {
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
    const mockedUseSavedJobsStore = vi.mocked(useSavedJobsStore);
    mockedUseSavedJobsStore.mockReturnValue({
      savedJobIds: [],
      savedJobs: [],
      toggleSaveJob: vi.fn(),
      isSaved: vi.fn().mockReturnValue(false),
    } satisfies SavedJobsStoreState);

    render(<JobCard job={mockJob} />);

    expect(screen.getByText("Test Job")).toBeDefined();
    expect(screen.getByText("1,000 USDC")).toBeDefined();
    expect(screen.getByText("react")).toBeDefined();
  });

  it("calls toggleSaveJob when bookmark button is clicked", () => {
    const toggleSaveJob = vi.fn();
    const mockedUseSavedJobsStore = vi.mocked(useSavedJobsStore);
    mockedUseSavedJobsStore.mockReturnValue({
      savedJobIds: [],
      savedJobs: [],
      toggleSaveJob,
      isSaved: vi.fn().mockReturnValue(false),
    } satisfies SavedJobsStoreState);

    render(<JobCard job={mockJob} />);

    const bookmarkButton = screen.getByLabelText("Save job");
    fireEvent.click(bookmarkButton);

    expect(toggleSaveJob).toHaveBeenCalledWith(mockJob);
  });
});
