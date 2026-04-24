import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { JobCard, type JobCardData } from "../job-card";
import { JobCardErrorBoundary } from "../job-card-error-boundary";

const createJob = (overrides: Partial<JobCardData> = {}): JobCardData => ({
  id: "job-123",
  title: "Build a Soroban escrow milestone system",
  description:
    "We need a developer to build an escrow milestone system on Soroban.",
  budget_usdc: 500000000,
  milestones: 3,
  client_address: "GCXDEV5E2J4JTS3Q3C5JZV4P5C7E",
  tags: ["soroban", "frontend", "devops"],
  deadlineAt: "2026-05-15T00:00:00Z",
  clientReputation: {
    scoreBps: 8500,
    totalJobs: 24,
    starRating: 4.5,
    averageStars: 4.2,
  },
  status: "open",
  created_at: "2026-04-01T00:00:00Z",
  ...overrides,
});

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("JobCard", () => {
  it("renders job title and description", () => {
    const job = createJob();
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("Build a Soroban escrow milestone system")).toBeInTheDocument();
    expect(
      screen.getByText(/We need a developer to build an escrow milestone system/)
    ).toBeInTheDocument();
  });

  it("renders status badge with correct color", () => {
    const job = createJob({ status: "open" });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("OPEN")).toBeInTheDocument();
  });

  it("renders tags as pills", () => {
    const job = createJob({ tags: ["soroban", "frontend"] });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("soroban")).toBeInTheDocument();
    expect(screen.getByText("frontend")).toBeInTheDocument();
  });

  it("renders budget formatted as USDC", () => {
    const job = createJob({ budget_usdc: 500000000 });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("$500.00")).toBeInTheDocument();
  });

  it("renders client address shortened", () => {
    const job = createJob({ client_address: "GCXDEV5E2J4JTS3Q3C5JZV4P5C7E" });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText(/GCXDEV\.\.\.C7E/)).toBeInTheDocument();
  });

  it("renders client reputation stars", () => {
    const job = createJob({
      clientReputation: {
        scoreBps: 8500,
        totalJobs: 24,
        starRating: 4.5,
        averageStars: 4.2,
      },
    });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("4.2")).toBeInTheDocument();
    expect(screen.getByText("24 jobs on-chain")).toBeInTheDocument();
  });

  it("renders milestone count", () => {
    const job = createJob({ milestones: 3 });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText("3 tracked")).toBeInTheDocument();
  });

  it("renders deadline date", () => {
    const job = createJob({ deadlineAt: "2026-05-15T00:00:00Z" });
    renderWithQuery(<JobCard job={job} />);

    expect(screen.getByText(/May 15, 2026/)).toBeInTheDocument();
  });

  it("links to job detail page", () => {
    const job = createJob({ id: "job-123" });
    renderWithQuery(<JobCard job={job} />);

    const link = screen.getByRole("link", { name: /View job:/ });
    expect(link).toHaveAttribute("href", "/jobs/job-123");
  });

  it("applies hover styles through group", () => {
    const job = createJob();
    const { container } = renderWithQuery(<JobCard job={job} />);

    const article = container.querySelector("article");
    expect(article?.className).toContain("group");
  });

  it("renders different status colors", () => {
    const statuses: Array<JobCardData["status"]> = [
      "open",
      "in_progress",
      "completed",
      "disputed",
    ];

    for (const status of statuses) {
      const { container } = renderWithQuery(<JobCard job={createJob({ status })} />);
      const badge = container.querySelector("article span");
      expect(badge).toBeInTheDocument();
    }
  });
});

describe("JobCardErrorBoundary", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "console",
      vi.fn({
        error: vi.fn(),
      }),
    );
  });

  it("renders children when no error", () => {
    render(
      <JobCardErrorBoundary>
        <div data-testid="child">Child Content</div>
      </JobCardErrorBoundary>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders error message when child throws", () => {
    const ErrorChild = () => {
      throw new Error("Test error");
    };

    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <JobCardErrorBoundary>
        <ErrorChild />
      </JobCardErrorBoundary>,
    );

    expect(screen.getByText(/Job unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/This listing failed to load/i)).toBeInTheDocument();
  });

  it("allows retry after error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    let renderCount = 0;
    const ErrorChild = () => {
      renderCount++;
      if (renderCount === 1) {
        throw new Error("Test error");
      }
      return <div>Recovered</div>;
    };

    render(
      <JobCardErrorBoundary>
        <ErrorChild />
      </JobCardErrorBoundary>,
    );

    expect(screen.getByText(/Job unavailable/i)).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /Retry/i });
    fireEvent.click(retryButton);

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("applies custom className to error state", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const ErrorChild = () => {
      throw new Error("Test error");
    };

    render(
      <JobCardErrorBoundary className="custom-class">
        <ErrorChild />
      </JobCardErrorBoundary>,
    );

    const errorContainer = screen.getByRole("alert");
    expect(errorContainer.className).toContain("custom-class");
  });
});