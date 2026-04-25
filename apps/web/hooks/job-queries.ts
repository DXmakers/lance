import { z } from "zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getReputationMetrics, type ReputationMetrics } from "@/lib/reputation";

import { JobSchema, type BoardJob, BoardJobSchema } from "@/types/jobs";

export type JobSort = 'newest' | 'oldest' | 'budget-high' | 'budget-low';
export const JOB_CATEGORIES = ["Development", "Design", "Marketing", "Legal", "Other"] as const;
export type JobCategory = typeof JOB_CATEGORIES[number];

const TAG_PATTERNS: Array<[string, RegExp]> = [
  ["soroban", /soroban|stellar|smart contract|escrow/i],
  ["frontend", /frontend|react|next|ui|dashboard/i],
  ["design", /design|brand|graphic|figma/i],
  ["devops", /deploy|infra|ci|ops|automation/i],
  ["ai", /judge|llm|agent|ai/i],
  ["growth", /seo|marketing|community|content/i],
];

function inferTags(job: { title: string; description: string }): string[] {
  const source = `${job.title} ${job.description}`;
  const tags = TAG_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([tag]) => tag);
  if (tags.length === 0) tags.push("general");
  return tags.slice(0, 3);
}

function buildDeadline(index: number, createdAt: string): string {
  const base = new Date(createdAt);
  base.setDate(base.getDate() + 5 + index * 3);
  return base.toISOString();
}

async function buildBoardJobs(sourceJobs: z.infer<typeof JobSchema>[]): Promise<BoardJob[]> {
  const uniqueClients = [...new Set(sourceJobs.map((job) => job.employerAddress))];
  const reputationEntries: Array<[string, ReputationMetrics]> = await Promise.all(
    uniqueClients.map(async (address) => [
      address,
      await getReputationMetrics(address, "client"),
    ] as [string, ReputationMetrics])
  );
  const reputationMap = new Map<string, ReputationMetrics>(reputationEntries);

  return sourceJobs.map((job, index) => ({
    ...job,
    tags: inferTags(job),
    deadlineAt: buildDeadline(index, job.created_at),
    clientReputation: reputationMap.get(job.employerAddress) ?? {
      scoreBps: 5000,
      totalJobs: 0,
      totalPoints: 0,
      reviews: 0,
      starRating: 2.5,
      averageStars: 2.5,
    },
  }));
}

/**
 * Hook to fetch and hydrate all open jobs.
 * Integrates with on-chain reputation metrics.
 */
export function useJobs() {
  return useSuspenseQuery<BoardJob[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const jobsFromApi = await api.jobs.list();
      
      // Map and validate raw API response to the new JobSchema
      const validatedJobs = jobsFromApi.map(rawJob => {
        const mappedJob = {
          id: rawJob.id,
          title: rawJob.title,
          description: rawJob.description,
          budget: rawJob.budget_usdc,
          status: rawJob.status.toLowerCase(),
          escrowId: rawJob.on_chain_job_id,
          employerAddress: rawJob.client_address,
          created_at: rawJob.created_at,
          updated_at: rawJob.updated_at,
        };
        return JobSchema.parse(mappedJob);
      });
      
      const hydratedJobs = await buildBoardJobs(validatedJobs);
      
      // Validate hydrated board jobs
      return hydratedJobs.map(job => BoardJobSchema.parse(job));
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
