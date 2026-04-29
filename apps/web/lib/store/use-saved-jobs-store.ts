import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardJob } from "@/hooks/use-job-board";

interface SavedJobsState {
  savedJobIds: string[];
  savedJobs: BoardJob[];
  toggleSaveJob: (job: BoardJob) => void;
  isSaved: (jobId: string) => boolean;
}

export const useSavedJobsStore = create<SavedJobsState>()(
  persist(
    (set, get) => ({
      savedJobIds: [],
      savedJobs: [],
      toggleSaveJob: (job) => {
        const { savedJobIds, savedJobs } = get();
        const isAlreadySaved = savedJobIds.includes(job.id);

        if (isAlreadySaved) {
          set({
            savedJobIds: savedJobIds.filter((id) => id !== job.id),
            savedJobs: savedJobs.filter((j) => j.id !== job.id),
          });
        } else {
          set({
            savedJobIds: [...savedJobIds, job.id],
            savedJobs: [job, ...savedJobs],
          });
        }
      },
      isSaved: (jobId) => get().savedJobIds.includes(jobId),
    }),
    {
      name: "lance-saved-jobs",
    }
  )
);
