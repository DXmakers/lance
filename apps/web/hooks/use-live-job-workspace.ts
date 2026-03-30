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
  type ReputationMetrics,
} from "@/lib/reputation";

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

      setJob(nextJob);
      setBids(nextBids);
      setMilestones(nextMilestones);
      setDeliverables(nextDeliverables);
      setDispute(nextDispute);

      const [nextClientRep, nextFreelancerRep] = await Promise.all([
        getReputationMetrics(nextJob.client_address, "client"),
        nextJob.freelancer_address
          ? getReputationMetrics(nextJob.freelancer_address, "freelancer")
          : Promise.resolve(null),
      ]);

      setClientReputation(nextClientRep);
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

  useEffect(() => {
    setLoading(true);
    void refresh();

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
