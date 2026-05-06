"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CreateJobBody } from "@/lib/api";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function useCreateJob() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: CreateJobBody) => api.jobs.create(body),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job posted successfully!");
      router.push(`/jobs/${job.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create job. Please try again.");
    },
  });
}
