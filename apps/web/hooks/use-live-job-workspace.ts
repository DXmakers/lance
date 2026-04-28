"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Bid,
  type Deliverable,
  type Dispute,
  type Job,
  type Milestone,
} from "@/lib/api";
import {
  getReputationMetrics,
  getReputationView,
  type ReputationMetrics,
} from "@/lib/reputation";

const bidReputationCache = new Map<string, ReputationMetrics>();

async function enrichBidReputations(bids: Bid[]): Promise<Bid[]> {
  const uniqueAddresses = [...new Set(bids.map((bid) => bid.freelancer_address))];
  const reputationEntries = await Promise.all(
    uniqueAddresses.map(async (address) => {
      const cached = bidReputationCache.get(address);
      if (cached) {
        return [address, cached] as const;
      }
      const metrics = await getReputationMetrics(address, "freelancer");
      bidReputationCache.set(address, metrics);
      return [address, metrics] as const;
    }),
  );

  const reputationMap = new Map(reputationEntries);

  return bids.map((bid) => ({
    ...bid,
    freelancerReputation: reputationMap.get(bid.freelancer_address),
  }));
}

export interface LiveJobWorkspace {
  job: Job | null;
  bids: Bid[];
  milestones: Milestone[];
  deliverables: Deliverable[];
  dispute: Dispute | null;
  clientReputation: ReputationMetrics | null;
  freelancerReputation: ReputationMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

async function safeLoadDispute(jobId: string) {
  try {
    return await api.jobs.dispute.get(jobId);
  } catch {
    return null;
  }
}

export function useLiveJobWorkspace(jobId: string): LiveJobWorkspace {
  const [job, setJob] = useState<Job | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [clientReputation, setClientReputation] =
    useState<ReputationMetrics | null>(null);
  const [freelancerReputation, setFreelancerReputation] =
    useState<ReputationMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextJob, nextBids, nextMilestones, nextDeliverables, nextDispute] =
        await Promise.all([
          api.jobs.get(jobId),
          api.bids.list(jobId).catch(() => []),
          api.jobs.milestones(jobId).catch(() => []),
          api.jobs.deliverables.list(jobId).catch(() => []),
          safeLoadDispute(jobId),
        ]);

      const enrichedBids = await enrichBidReputations(nextBids);
      enrichedBids.sort((left, right) => {
        const leftScore = left.freelancerReputation?.scoreBps ?? 0;
        const rightScore = right.freelancerReputation?.scoreBps ?? 0;
        if (rightScore !== leftScore) return rightScore - leftScore;
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      });

      setJob(nextJob);
      setBids(enrichedBids);
      setMilestones(nextMilestones);
      setDeliverables(nextDeliverables);
      setDispute(nextDispute);

      const [nextClientView, nextFreelancerRep] = await Promise.all([
        getReputationView(nextJob.client_address),
        nextJob.freelancer_address
          ? getReputationMetrics(nextJob.freelancer_address, "freelancer")
          : Promise.resolve(null),
      ]);

      setClientReputation(nextClientView.client);
      setFreelancerReputation(nextFreelancerRep);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load job workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const [prevJobId, setPrevJobId] = useState(jobId);
  if (jobId !== prevJobId) {
    setPrevJobId(jobId);
    setLoading(true);
  }

  useEffect(() => {
    setTimeout(() => void refresh(), 0);

    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, [jobId, refresh]);

  return {
    job,
    bids,
    milestones,
    deliverables,
    dispute,
    clientReputation,
    freelancerReputation,
    loading,
    error,
    refresh,
  };
}
