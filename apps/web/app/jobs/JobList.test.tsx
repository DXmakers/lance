import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobsPage from "./page";
import * as jobQueries from "../../hooks/job-queries";

// Mock the query hook to isolate UI testing from network/msw logic in this unit test
vi.mock("../../hooks/job-queries", () => ({
  useJobs: vi.fn(),
}));

const useJobsMock = vi.mocked(jobQueries.useJobs);

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const mockJobs: jobQueries.BoardJob[] = [
  {
    id: "1",
    title: "Senior Soroban Developer",
    description: "Build an escrow system on Stellar.",
    budget: 5000 * 10_000_000,
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ["soroban", "stellar"],
    deadlineAt: new Date().toISOString(),
    employerAddress: "GABC123",
    clientReputation: {
      scoreBps: 9000,
      totalJobs: 5,
      totalPoints: 45,
      reviews: 5,
      starRating: 5,
      averageStars: 5,
    },
  },
  {
    id: "2",
    title: "UI Designer",
    description: "Design a marketplace dashboard.",
    budget: 2000 * 10_000_000,
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ["design", "figma"],
    deadlineAt: new Date().toISOString(),
    employerAddress: "GDEF456",
    clientReputation: {
      scoreBps: 7000,
      totalJobs: 2,
      totalPoints: 14,
      reviews: 2,
      starRating: 4,
      averageStars: 4,
    },
  },
];

describe("JobList / JobsPage CI Audit", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it("renders the job list after successful data fetch", async () => {
    useJobsMock.mockReturnValue({
      data: mockJobs,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof jobQueries.useJobs>);

    const { findByText } = render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    );

    expect(await findByText("Senior Soroban Developer")).toBeDefined();
    expect(await findByText("UI Designer")).toBeDefined();
  });

  it("filters jobs by search query", async () => {
    useJobsMock.mockReturnValue({
      data: mockJobs,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof jobQueries.useJobs>);

    const { findByText, queryByText, findByPlaceholderText } = render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    );

    const searchInput = await findByPlaceholderText("Search jobs...");
    const userEvent = (await import("@testing-library/user-event")).default;
    await userEvent.type(searchInput, "Soroban");

    expect(await findByText("Senior Soroban Developer")).toBeDefined();
    expect(queryByText("UI Designer")).toBeNull();
  });

  it("filters jobs by category", async () => {
    useJobsMock.mockReturnValue({
      data: mockJobs,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof jobQueries.useJobs>);

    const { findByText, queryByText } = render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    );

    // Categories are in a select element
    const categorySelect = document.querySelector('select');
    if (!categorySelect) throw new Error("Category select not found");
    
    const userEvent = (await import("@testing-library/user-event")).default;
    await userEvent.selectOptions(categorySelect, "Design");

    expect(await findByText("UI Designer")).toBeDefined();
    expect(queryByText("Senior Soroban Developer")).toBeNull();
  });

  it("shows skeleton state while loading", () => {
    useJobsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof jobQueries.useJobs>);

    const { getByRole, getByText } = render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    );

    expect(getByRole("status")).toBeDefined();
    expect(getByText(/Loading jobs.../i)).toBeDefined();
  });

  it("triggers Error Boundary on fetch failure", async () => {
    useJobsMock.mockImplementation(() => {
      throw new Error("Network Disruption");
    });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { findByText } = render(
      <QueryClientProvider client={queryClient}>
        <JobsPage />
      </QueryClientProvider>
    );

    expect(await findByText("Something went wrong")).toBeDefined();
    expect(await findByText(/Network Disruption/i)).toBeDefined();
    
    spy.mockRestore();
  });
});
