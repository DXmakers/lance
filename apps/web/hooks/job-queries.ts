import { useQuery } from "@tanstack/react-query";
import { api, type Job } from "@/lib/api";
import { getReputationMetrics, type ReputationMetrics } from "@/lib/reputation";

export type JobSort = "budget" | "chronological" | "reputation";

export interface BoardJob extends Job {
  tags: string[];
  deadlineAt: string;
  clientReputation: ReputationMetrics;
}

const TAG_PATTERNS: Array<[string, RegExp]> = [
  ["soroban", /soroban|stellar|smart contract|escrow/i],
  ["frontend", /frontend|react|next|ui|dashboard/i],
  ["design", /design|brand|graphic|figma/i],
  ["devops", /deploy|infra|ci|ops|automation/i],
  ["ai", /judge|llm|agent|ai/i],
  ["growth", /seo|marketing|community|content/i],
];

function inferTags(job: Job): string[] {
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

async function buildBoardJobs(sourceJobs: Job[]): Promise<BoardJob[]> {
  const uniqueClients = [...new Set(sourceJobs.map((job) => job.client_address))];
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
    clientReputation: reputationMap.get(job.client_address) ?? {
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
  return useQuery<BoardJob[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const jobsFromApi = await api.jobs.list();
      // If API fails or is empty, we could throw or handle mock here, 
      // but let's assume API is stable for now or handled in queryFn.
      return buildBoardJobs(jobsFromApi);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
