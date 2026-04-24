"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Job, type Milestone, type Bid, type Deliverable, type CreateJobBody, type MarkFundedBody, type CreateBidBody, type SubmitDeliverableBody } from "@/lib/api";

const JOB_KEYS = {
  all: ["jobs"] as const,
  lists: () => [...JOB_KEYS.all, "list"] as const,
  list: (filters?: Record<string, unknown>) => [...JOB_KEYS.lists(), filters] as const,
  details: () => [...JOB_KEYS.all, "detail"] as const,
  detail: (id: string) => [...JOB_KEYS.details(), id] as const,
  milestones: (jobId: string) => [...JOB_KEYS.detail(jobId), "milestones"] as const,
  bids: (jobId: string) => [...JOB_KEYS.detail(jobId), "bids"] as const,
  deliverables: (jobId: string) => [...JOB_KEYS.detail(jobId), "deliverables"] as const,
};

export function useJob(id: string) {
  return useQuery({
    queryKey: JOB_KEYS.detail(id),
    queryFn: () => api.jobs.get(id),
    enabled: Boolean(id),
    staleTime: 30000,
  });
}

export function useJobMilestones(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.milestones(jobId),
    queryFn: () => api.jobs.milestones(jobId),
    enabled: Boolean(jobId),
    staleTime: 20000,
  });
}

export function useJobBids(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.bids(jobId),
    queryFn: () => api.bids.list(jobId),
    enabled: Boolean(jobId),
    staleTime: 15000,
  });
}

export function useJobDeliverables(jobId: string) {
  return useQuery({
    queryKey: JOB_KEYS.deliverables(jobId),
    queryFn: () => api.jobs.deliverables.list(jobId),
    enabled: Boolean(jobId),
    staleTime: 10000,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateJobBody) => api.jobs.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: JOB_KEYS.lists() });
    },
  });
}

export function useMarkJobFunded() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MarkFundedBody }) =>
      api.jobs.markFunded(id, body),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.detail(id) });
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.lists() });
    },
  });
}

export function useCreateBid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: CreateBidBody }) =>
      api.bids.create(jobId, body),
    onSuccess: (_data, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.bids(jobId) });
    },
  });
}

export function useSubmitDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: SubmitDeliverableBody }) =>
      api.jobs.deliverables.submit(jobId, body),
    onSuccess: (_data, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.deliverables(jobId) });
    },
  });
}

export function useReleaseMilestone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, milestoneId }: { jobId: string; milestoneId: string }) =>
      api.jobs.releaseMilestone(jobId, milestoneId),
    onSuccess: (_data, { jobId }) => {
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.milestones(jobId) });
      queryClient.invalidateQueries({ queryKey: JOB_KEYS.detail(jobId) });
    },
  });
}