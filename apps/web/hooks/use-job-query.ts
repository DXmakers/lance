"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getReputationMetrics, getReputationView } from "@/lib/reputation";

export function useJobQuery(jobId: string) {
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const [job, bids, milestones, deliverables, dispute] = await Promise.all([
        api.jobs.get(jobId),
        api.bids.list(jobId).catch(() => []),
        api.jobs.milestones(jobId).catch(() => []),
        api.jobs.deliverables.list(jobId).catch(() => []),
        api.jobs.dispute.get(jobId).catch(() => null),
      ]);

      const [clientView, freelancerRep] = await Promise.all([
        getReputationView(job.client_address),
        job.freelancer_address
          ? getReputationMetrics(job.freelancer_address, "freelancer")
          : Promise.resolve(null),
      ]);

      return {
        job,
        bids,
        milestones,
        deliverables,
        dispute,
        clientReputation: clientView.client,
        freelancerReputation: freelancerRep,
      };
    },
    refetchInterval: 4000, // Poll every 4 seconds as per previous implementation
  });

  const createBidMutation = useMutation({
    mutationFn: (data: { freelancer_address: string; proposal: string }) =>
      api.bids.create(jobId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  const acceptBidMutation = useMutation({
    mutationFn: (data: { bidId: string; client_address: string }) =>
      api.bids.accept(jobId, data.bidId, { client_address: data.client_address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  const submitDeliverableMutation = useMutation({
    mutationFn: (data: {
      submitted_by: string;
      label: string;
      kind: string;
      url: string;
      file_hash?: string;
    }) => api.jobs.deliverables.submit(jobId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  const releaseMilestoneMutation = useMutation({
    mutationFn: (milestoneId: string) => api.jobs.releaseMilestone(jobId, milestoneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });

  return {
    ...jobQuery,
    mutations: {
      createBid: createBidMutation,
      acceptBid: acceptBidMutation,
      submitDeliverable: submitDeliverableMutation,
      releaseMilestone: releaseMilestoneMutation,
    },
  };
}
