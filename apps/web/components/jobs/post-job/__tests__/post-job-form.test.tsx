import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostJobForm } from "../post-job-form";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock dependencies before importing component
vi.mock("@/hooks/use-post-job", () => ({
  usePostJob: vi.fn(() => ({
    submit: vi.fn(),
    isSubmitting: false,
  })),
}));

vi.mock("@/lib/store/use-tx-status-store", () => ({
  useTxStatusStore: vi.fn(() => ({
    step: "idle",
  })),
}));

vi.mock("@/components/transaction/transaction-tracker", () => ({
  TransactionTracker: () => <div>TransactionTracker</div>,
}));

vi.mock("@/components/ui/rich-text-editor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="rich-text-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "QueryClientProviderWrapper";
  return Wrapper;
}

describe("PostJobForm", () => {
  const mockUsePostJob = vi.mocked(usePostJob, true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePostJob.mockReturnValue({
      submit: vi.fn(),
      isSubmitting: false,
    });
  });

  it("renders step indicator with three steps", () => {
    render(<PostJobForm />, { wrapper: createWrapper() });
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows step 1 (details) by default", () => {
    render(<PostJobForm />, { wrapper: createWrapper() });
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    expect(screen.getByTestId("rich-text-editor")).toBeInTheDocument();
    expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required skills/i)).toBeInTheDocument();
  });

  it("allows user to fill in title, description, tags, and skills", async () => {
    render(<PostJobForm />, { wrapper: createWrapper() });

    const titleInput = screen.getByLabelText(/job title/i);
    fireEvent.change(titleInput, { target: { value: "Build a smart contract" } });
    expect(titleInput).toHaveValue("Build a smart contract");

    const descriptionInput = screen.getByTestId("rich-text-editor");
    fireEvent.change(descriptionInput, { target: { value: "Detailed scope here" } });
    expect(descriptionInput).toHaveValue("Detailed scope here");

    const tagsInput = screen.getByLabelText(/tags/i);
    fireEvent.change(tagsInput, { target: { value: "soroban, defi" } });
    expect(tagsInput).toHaveValue("soroban, defi");

    const skillsInput = screen.getByLabelText(/required skills/i);
    fireEvent.change(skillsInput, { target: { value: "Rust, TypeScript" } });
    expect(skillsInput).toHaveValue("Rust, TypeScript");
  });

  it("navigates to step 2 when Continue is clicked with valid step 1 data", async () => {
    render(<PostJobForm />, { wrapper: createWrapper() });

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/job title/i), {
      target: { value: "Test Job Title" },
    });
    fireEvent.change(screen.getByTestId("rich-text-editor"), {
      target: { value: "This is a test job description that is long enough." },
    });
    fireEvent.change(screen.getByLabelText(/tags/i), {
      target: { value: "test" },
    });
    fireEvent.change(screen.getByLabelText(/required skills/i), {
      target: { value: "testing" },
    });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeInTheDocument();
    });
  });

  it("shows validation error if step 1 fields are empty", async () => {
    render(<PostJobForm />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/at least 5 characters/i);
    });
  });

  it("returns to step 1 when Back is clicked on step 2", async () => {
    render(<PostJobForm />, { wrapper: createWrapper() });

    // Go to step 2
    fireEvent.change(screen.getByLabelText(/job title/i), { target: { value: "Test Job Title Long Enough" } });
    fireEvent.change(screen.getByTestId("rich-text-editor"), { target: { value: "Description with sufficient length for validation." } });
    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: "test" } });
    fireEvent.change(screen.getByLabelText(/required skills/i), { target: { value: "testing" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    });
  });

  it("submits the form successfully on step 3", async () => {
    render(<PostJobForm />, { wrapper: createWrapper() });

    // Complete step 1
    fireEvent.change(screen.getByLabelText(/job title/i), { target: { value: "Test Job Title" } });
    fireEvent.change(screen.getByTestId("rich-text-editor"), { target: { value: "Description with sufficient length for validation purposes." } });
    fireEvent.change(screen.getByLabelText(/tags/i), { target: { value: "test" } });
    fireEvent.change(screen.getByLabelText(/required skills/i), { target: { value: "testing" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeInTheDocument();
    });

    // Complete step 2
    fireEvent.change(screen.getByLabelText(/budget \(usdc\)/i), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText(/milestones/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/review job metadata/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /post job on-chain/i }));

    await waitFor(() => {
      const { submit } = mockUsePostJob.mock.results[0].value;
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test Job Title",
          budgetUsdc: 1000_000_000,
          milestones: 2,
        })
      );
    });
  });
});
