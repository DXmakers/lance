import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CreateBidBody, type AcceptBidBody } from "@/lib/api";
import { getReputationMetrics, getReputationView } from "@/lib/reputation";

export function useJobQuery(jobId: string) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId),
  });
}

export function useBidsQuery(jobId: string) {
  return useQuery({
    queryKey: ["bids", jobId],
    queryFn: () => api.bids.list(jobId),
  });
}

export function useMilestonesQuery(jobId: string) {
  return useQuery({
    queryKey: ["milestones", jobId],
    queryFn: () => api.jobs.milestones(jobId),
  });
}

export function useDeliverablesQuery(jobId: string) {
  return useQuery({
    queryKey: ["deliverables", jobId],
    queryFn: () => api.jobs.deliverables.list(jobId),
  });
}

export function useDisputeQuery(jobId: string) {
  return useQuery({
    queryKey: ["dispute", jobId],
    queryFn: async () => {
      try {
        return await api.jobs.dispute.get(jobId);
      } catch {
        return null;
      }
    },
  });
}

export function useReputationQuery(address: string | undefined, type: "client" | "freelancer") {
  return useQuery({
    queryKey: ["reputation", address, type],
    queryFn: async () => {
      if (!address) return null;
      if (type === "client") {
        const view = await getReputationView(address);
        return view.client;
      } else {
        return await getReputationMetrics(address, "freelancer");
      }
    },
    enabled: !!address,
  });
}

export function useCreateBidMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBidBody) => api.bids.create(jobId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bids", jobId] });
    },
  });
}

export function useAcceptBidMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bidId, body }: { bidId: string; body: AcceptBidBody }) =>
      api.bids.accept(jobId, bidId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["bids", jobId] });
    },
  });
}
