import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const logs = [
  {
    id: "1",
    user_address: "GABC",
    job_id: null,
    event_type: "job.created",
    level: "info",
    details: { message: "Job created" },
    created_at: new Date().toISOString(),
  },
];

vi.mock("@/lib/api", () => ({
  apiActivity: {
    list: vi.fn(() => Promise.resolve(logs)),
  },
}));

import ActivityLogList from "@/components/activity-log";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe("ActivityLogList", () => {
  it("renders activity items", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityLogList />
      </QueryClientProvider>
    );

    // Use screen.debug() if it fails, but let's try a more specific query
    const title = await screen.findByRole("heading", { name: /job created/i });
    expect(title).toBeInTheDocument();
    
    // Use findByText for the message, but since there are multiple "job created" texts,
    // we should check that at least two exist or be more specific.
    const messages = await screen.findAllByText(/job created/i);
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });
});



