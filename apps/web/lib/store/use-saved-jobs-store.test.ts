/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { useSavedJobsStore } from "./use-saved-jobs-store";
import type { BoardJob } from "@/hooks/use-job-board";

const MOCK_JOB: BoardJob = {
  id: "test-job-1",
  title: "Test Job",
  description: "Test Description",
  budget_usdc: 1000000000,
  milestones: 1,
  client_address: "G123",
  status: "open",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ["test"],
  deadlineAt: new Date().toISOString(),
  clientReputation: {
    scoreBps: 5000,
    totalJobs: 0,
    totalPoints: 0,
    reviews: 0,
    starRating: 5,
    averageStars: 5,
  },
};

describe("useSavedJobsStore", () => {
  beforeEach(() => {
    // Reset the store state before each test if necessary
    // Since it's using persist, we might need to clear localStorage
    localStorage.clear();
    useSavedJobsStore.setState({ savedJobIds: [], savedJobs: [] });
  });

  it("should start with an empty list", () => {
    const state = useSavedJobsStore.getState();
    expect(state.savedJobIds).toEqual([]);
    expect(state.savedJobs).toEqual([]);
  });

  it("should toggle saving a job", () => {
    useSavedJobsStore.getState().toggleSaveJob(MOCK_JOB);
    
    let state = useSavedJobsStore.getState();
    expect(state.savedJobIds).toContain(MOCK_JOB.id);
    expect(state.savedJobs).toContainEqual(MOCK_JOB);
    expect(state.isSaved(MOCK_JOB.id)).toBe(true);

    // Toggle again to remove
    useSavedJobsStore.getState().toggleSaveJob(MOCK_JOB);
    state = useSavedJobsStore.getState();
    expect(state.savedJobIds).not.toContain(MOCK_JOB.id);
    expect(state.savedJobs).not.toContainEqual(MOCK_JOB);
    expect(state.isSaved(MOCK_JOB.id)).toBe(false);
  });
});
