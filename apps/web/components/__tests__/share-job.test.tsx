import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShareJob } from "../jobs/share-job";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("ShareJob Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <ShareJob jobId="123" jobTitle="Frontend Developer" />
      </QueryClientProvider>
    );

  it("renders correctly with job title", () => {
    renderComponent();
    expect(screen.getByText(/Frontend Developer/i)).toBeInTheDocument();
  });

  it("allows copying the share URL to clipboard", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockImplementation(() => Promise.resolve()) },
    });
    renderComponent();
    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it("validates email input using Zod and disallows invalid emails", async () => {
    renderComponent();
    const emailInput = screen.getByPlaceholderText(/colleague@domain\.com/i);
    const sendButton = screen.getByRole("button", { name: /send invitation/i });

    fireEvent.change(emailInput, { target: { value: "invalid-email" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
    });
  });

  it("sends email successfully when valid email is provided", async () => {
    renderComponent();
    const emailInput = screen.getByPlaceholderText(/colleague@domain\.com/i);
    const sendButton = screen.getByRole("button", { name: /send invitation/i });

    fireEvent.change(emailInput, { target: { value: "valid@example.com" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sending invitation/i })).toBeInTheDocument();
    });
  });
});
