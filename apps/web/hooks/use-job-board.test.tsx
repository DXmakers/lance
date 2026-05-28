import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useJobBoard } from "@/hooks/use-job-board";
import { api } from "@/lib/api";
import { getReputationMetrics } from "@/lib/reputation";

// Mock modules
vi.mock("@/lib/api", () => ({
  api: {
    jobs: {
      list: vi.fn(),
    },
  },
}));

vi.mock("@/lib/reputation", () => ({
  getReputationMetrics: vi.fn(),
}));

const mockJobs = Array.from({ length: 12 }, (_, i) => ({
  id: `job-${i + 1}`,
  title: `Test Job ${i + 1}`,
  description: "A test job description",
  budget_usdc: 1000 * 10_000_000,
  milestones: 2,
  client_address: `0xClient${String(i).padStart(2, "0")}`,
  freelancer_address: undefined,
  status: "open",
  metadata_hash: undefined,
  on_chain_job_id: undefined,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
  updated_at: new Date(Date.now() - i * 86400000).toISOString(),
}));

const mockReputation = {
  scoreBps: 5500,
  totalJobs: 10,
  totalPoints: 500,
  reviews: 8,
  starRating: 4.5,
  averageStars: 4.5,
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

describe("useJobBoard", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  it("initializes with correct default state", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.jobs).toHaveLength(12);
    expect(result.current.paginatedJobs).toHaveLength(6);
    expect(result.current.pagination.page).toBe(1);
    expect(result.current.pagination.pageSize).toBe(6);
    expect(result.current.pagination.totalPages).toBe(2);
    expect(result.current.pagination.totalCount).toBe(12);
    expect(result.current.pagination.hasNextPage).toBe(true);
    expect(result.current.pagination.hasPrevPage).toBe(false);
  });

  it("returns mock jobs on API error", async () => {
    (api.jobs.list as vi.Mock).mockRejectedValue(new Error("Network error"));
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Network error");
    expect(result.current.jobs.length).toBeGreaterThan(0);
  });

  it("pagination: changes page updates visible jobs", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.paginatedJobs).toHaveLength(6);
    expect(result.current.paginatedJobs[0].id).toBe("job-1");

    act(() => {
      result.current.actions.setPage(2);
    });

    await waitFor(() => {
      expect(result.current.pagination.page).toBe(2);
    });

    expect(result.current.paginatedJobs).toHaveLength(6);
    expect(result.current.paginatedJobs[0].id).toBe("job-7");
  });

  it("pagination: changes pageSize updates count", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pagination.totalPages).toBe(2);

    act(() => {
      result.current.actions.setPageSize(12);
    });

    await waitFor(() => {
      expect(result.current.pagination.pageSize).toBe(12);
    });

    expect(result.current.pagination.totalPages).toBe(1);
    expect(result.current.paginatedJobs).toHaveLength(12);
  });

  it("filtering by tag resets page to 1", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pagination.page).toBe(1);

    act(() => {
      result.current.actions.setPage(2);
    });
    await waitFor(() => expect(result.current.pagination.page).toBe(2));

    act(() => {
      result.current.actions.setActiveTag("frontend");
    });

    await waitFor(() => {
      expect(result.current.pagination.page).toBe(1);
    });
  });

  it("search query resets page to 1", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.actions.setPage(2);
    });
    await waitFor(() => expect(result.current.pagination.page).toBe(2));

    act(() => {
      result.current.actions.setQuery("design");
    });

    await waitFor(() => {
      expect(result.current.pagination.page).toBe(1);
    });
  });

  it("page number clamping when beyond totalPages", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs.slice(0, 2));
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard({ defaultPageSize: 6 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pagination.totalPages).toBe(1);

    act(() => {
      result.current.actions.setPage(5);
    });

    await waitFor(() => {
      expect(result.current.pagination.page).toBe(1);
    });
  });

  it("sorting resets page to 1", async () => {
    (api.jobs.list as vi.Mock).mockResolvedValue(mockJobs);
    (getReputationMetrics as vi.Mock).mockResolvedValue(mockReputation);

    const { result } = renderHook(() => useJobBoard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.actions.setPage(2);
    });
    await waitFor(() => expect(result.current.pagination.page).toBe(2));

    act(() => {
      result.current.actions.setSortBy("budget");
    });

    await waitFor(() => {
      expect(result.current.pagination.page).toBe(1);
    });
  });
});
