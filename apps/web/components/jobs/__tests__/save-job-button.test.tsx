import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SaveJobButton } from "../save-job-button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWalletSession } from "@/hooks/use-wallet-session";

vi.mock("@/lib/api", () => ({
  api: {
    users: {
      savedJobs: vi.fn(),
    },
    jobs: {
      save: vi.fn(),
      unsave: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/use-wallet-session", () => ({
  useWalletSession: vi.fn(),
}));

// Mock ResizeObserver for Popover
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock pointer events for Radix UI
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
}

describe("SaveJobButton", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <SaveJobButton jobId="123" />
      </QueryClientProvider>
    );
  };

  it("renders disabled button when wallet is not connected", () => {
    (useWalletSession as jest.Mock).mockReturnValue({ address: null });
    (api.users.savedJobs as jest.Mock).mockResolvedValue([]);
    renderComponent();
    
    const button = screen.getByRole("button", { name: /save job/i });
    expect(button).toBeDisabled();
  });

  it("opens popover and saves job with note", async () => {
    (useWalletSession as jest.Mock).mockReturnValue({ address: "G123" });
    (api.users.savedJobs as jest.Mock).mockResolvedValue([]);
    (api.jobs.save as jest.Mock).mockResolvedValue({ id: "1", note: "test" });

    renderComponent();

    const button = await screen.findByRole("button", { name: /save job/i });
    fireEvent.click(button);

    const textarea = await screen.findByPlaceholderText(/Great match/i);
    fireEvent.change(textarea, { target: { value: "test note" } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.jobs.save).toHaveBeenCalledWith("123", "G123", { note: "test note" });
    });
  });

  it("validates long notes", async () => {
    (useWalletSession as jest.Mock).mockReturnValue({ address: "G123" });
    (api.users.savedJobs as jest.Mock).mockResolvedValue([]);

    renderComponent();

    const button = await screen.findByRole("button", { name: /save job/i });
    fireEvent.click(button);

    const textarea = await screen.findByPlaceholderText(/Great match/i);
    const longText = "a".repeat(256);
    fireEvent.change(textarea, { target: { value: longText } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    expect(await screen.findByText(/Note must be under 255 characters/i)).toBeInTheDocument();
  });

  it("unsaves a job if already saved", async () => {
    (useWalletSession as jest.Mock).mockReturnValue({ address: "G123" });
    (api.users.savedJobs as jest.Mock).mockResolvedValue([{ job_id: "123" }]);
    (api.jobs.unsave as jest.Mock).mockResolvedValue({});

    renderComponent();

    const button = await screen.findByRole("button", { name: /saved/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(api.jobs.unsave).toHaveBeenCalledWith("123", "G123");
    });
  });
});
