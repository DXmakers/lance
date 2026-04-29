"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Job } from "@/lib/api";
import {
  getReputationMetrics,
  type ReputationMetrics,
} from "@/lib/reputation";

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

const MOCK_TITLES = [
  "Design a Stellar-native creator dashboard",
  "Ship a Soroban escrow milestone system",
  "Refactor dispute evidence ingestion pipeline",
  "Brand identity system for premium freelancing studio",
  "Build an analytics cockpit for job execution",
  "OpenClaw judge prompt evaluation sprint",
  "Marketing site revamp for high-ticket consulting",
  "DevOps hardening for release workflows",
  "Client portal for milestone approvals",
  "Portfolio refresh for an enterprise freelancer collective",
  "Soroban reputation viewer with trust signals",
  "Creative direction pack for product launch",
];

function inferTags(job: Job): string[] {
  const source = `${job.title} ${job.description}`;
  const tags = TAG_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(
    ([tag]) => tag,
  );

  if (tags.length === 0) {
    tags.push("general");
  }

  return tags.slice(0, 3);
}

function buildDeadline(index: number, createdAt: string): string {
  const base = new Date(createdAt);
  base.setDate(base.getDate() + 5 + index * 3);
  return base.toISOString();
}

function createMockJobs(): Job[] {
  return Array.from({ length: 18 }, (_, index) => {
    const createdAt = new Date(Date.now() - index * 86400000).toISOString();
    return {
      id: `mock-job-${index + 1}`,
      title: MOCK_TITLES[index % MOCK_TITLES.length],
      description:
        "Curated mock marketplace record used when the backend is unavailable. This still exercises filtering, sorting, and the presentational layout cleanly.",
      budget_usdc: (1800 + index * 350) * 10_000_000,
      milestones: (index % 3) + 1,
      client_address: `GMOCKCLIENTADDRESS${String(index).padStart(2, "0")}XXXXXXXXXXXXXXXXXXXX`,
      freelancer_address: undefined,
      status: "open",
      metadata_hash: undefined,
      on_chain_job_id: undefined,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
}

async function buildBoardJobs(sourceJobs: Job[]): Promise<BoardJob[]> {
  const uniqueClients = [...new Set(sourceJobs.map((job) => job.client_address))];
  const reputationEntries: Array<[string, ReputationMetrics]> = await Promise.all(
    uniqueClients.map(async (address) => [
      address,
      await getReputationMetrics(address, "client"),
    ] as [string, ReputationMetrics]),
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

export interface UseJobBoardOptions {
  defaultPageSize?: number;
}

export function useJobBoard(options: UseJobBoardOptions = {}) {
  const defaultPageSize = options.defaultPageSize ?? 6;

  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [sortBy, setSortBy] = useState<JobSort>("chronological");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [apiError, setApiError] = useState<string | null>(null);
  const [minBudget, setMinBudget] = useState<number | undefined>(undefined);
  const [maxBudget, setMaxBudget] = useState<number | undefined>(undefined);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const deferredQuery = useDeferredValue(query);

  const { data: allJobs = [], isLoading } = useQuery<BoardJob[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      try {
        const jobsFromApi = await api.jobs.list();
        const sourceJobs = jobsFromApi.length > 0 ? jobsFromApi : createMockJobs();
        const result = await buildBoardJobs(sourceJobs);
        setApiError(null);
        return result;
      } catch (err) {
        const fallback = await buildBoardJobs(createMockJobs());
        const message =
          err instanceof Error ? err.message : "Unable to load live jobs right now.";
        setApiError(message);
        return fallback;
      }
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

 useEffect(() => {
    startTransition(() => {
      setPage(1);
    });
  }, [query, activeTag, sortBy]);

  const availableTags = useMemo(() => {
    const tags = new Set(allJobs.flatMap((job) => job.tags));
    return ["all", ...tags];
  }, [allJobs]);

  const visibleJobs = useMemo(() => {
        let result = allJobs;

    if (filterStatus !== "all") {
      result = result.filter((job) => job.status === filterStatus);
    }

    if (minBudget !== undefined && minBudget > 0) {
      result = result.filter((job) => (job.budget_usdc / 10_000_000) >= minBudget);
    }

    if (maxBudget !== undefined && maxBudget > 0) {
      result = result.filter((job) => (job.budget_usdc / 10_000_000) <= maxBudget);
    }

    if (activeTag !== "all") {
      result = result.filter((job) => job.tags.includes(activeTag));
    }

    if (deferredQuery.trim()) {
      const term = deferredQuery.trim().toLowerCase();
      result = result.filter((job) =>
        [job.title, job.description, job.client_address, ...job.tags]
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
    }

    result = [...result].sort((left, right) => {
      if (sortBy === "budget") {
        return right.budget_usdc - left.budget_usdc;
      }
      if (sortBy === "reputation") {
        return right.clientReputation.scoreBps - left.clientReputation.scoreBps;
      }
      return (
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      );
    });

    return result;
  }, [allJobs, activeTag, deferredQuery, sortBy, minBudget, maxBudget, filterStatus]);

  const totalPages = Math.ceil(visibleJobs.length / pageSize);
  const safePage = Math.min(Math.max(page, 1), totalPages || 1);

  const paginatedJobs = useMemo(() => {
    if (totalPages === 0) return [];
    const start = (safePage - 1) * pageSize;
    return visibleJobs.slice(start, start + pageSize);
  }, [visibleJobs, safePage, pageSize, totalPages]);

  const actions = {
    setMinBudget,
    setMaxBudget,
    setFilterStatus,
    setQuery,
    setActiveTag(nextTag: string) {
      startTransition(() => {
        setActiveTag(nextTag);
      });
    },
    setSortBy(nextSort: JobSort) {
      startTransition(() => {
        setSortBy(nextSort);
      });
    },
    setPage(newPage: number) {
      startTransition(() => {
        setPage(newPage);
      });
    },
    setPageSize(newSize: number) {
      startTransition(() => {
        setPageSize(newSize);
        setPage(1);
      });
    },
  };

  return {
    jobs: visibleJobs,
    paginatedJobs,
    loading: isLoading,
    error: apiError,
    query,
    activeTag,
    sortBy,
    availableTags,
    minBudget,
    maxBudget,
    filterStatus,
    pagination: {
      page: safePage,
      pageSize,
      totalPages,
      totalCount: visibleJobs.length,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
    actions,
  };
}
