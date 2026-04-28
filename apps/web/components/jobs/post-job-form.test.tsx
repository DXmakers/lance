import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { PostJobForm, postJobSchema } from "./post-job-form";

// ── Mock store builder ─────────────────────────────────────────────────────────

function buildMockTxStore(overrides = {}) {
  return {
    step: "idle",
    detail: null,
    txHash: null,
    rawXdr: null,
    simulation: null,
    startedAt: null,
    finishedAt: null,
    setStep: vi.fn(),
    setTxHash: vi.fn(),
    setRawXdr: vi.fn(),
    setSimulation: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

// ── Mock hooks ─────────────────────────────────────────────────────────────────

const usePostJobMock = vi.fn();

vi.mock("@/hooks/use-post-job", () => ({
  usePostJob: () => usePostJobMock(),
}));

vi.mock("@/lib/store/use-tx-status-store", () => {
  return {
    useTxStatusStore: (selector?: (state: ReturnType<typeof buildMockTxStore>) => any) => {
      const store = buildMockTxStore();
      if (typeof selector === "function") {
        return selector(store);
      }
      return store;
    },
  };
});

// ── Render helper ───────────────────────────────────────────────────────────────

function renderForm(overrides = {}) {
  const onSuccess = vi.fn();
  const onError = vi.fn();

  usePostJobMock.mockReturnValue({
    submit: vi.fn().mockResolvedValue({}),
    isSubmitting: false,
    ...overrides,
  });

  render(<PostJobForm onSuccess={onSuccess} onError={onError} />);

  return { onSuccess, onError, mockUsePostJob: usePostJobMock };
}

// ── Zod schema validation tests ────────────────────────────────────────────────

describe("postJobSchema", () => {
  const baseValid = {
    title: "Build a Soroban Smart Contract",
    description: "A".repeat(50),
    skills: ["react"],
    budgetUsdc: 1000,
    deadline: "2026-12-31",
    paymentType: "fixed" as const,
  };

  describe("title", () => {
    it("rejects titles shorter than 5 characters", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        title: "Hi",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("at least 5 characters"))).toBe(true);
    });

    it("rejects titles longer than 100 characters", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        title: "a".repeat(101),
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("100 characters"))).toBe(true);
    });

    it("accepts a valid title", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        title: "Build a Soroban Smart Contract",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("description", () => {
    it("rejects descriptions shorter than 50 characters", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        description: "Too short",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("at least 50"))).toBe(true);
    });

    it("rejects descriptions longer than 5000 characters", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        description: "a".repeat(5001),
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("5,000"))).toBe(true);
    });

    it("accepts a valid description", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        description: "A".repeat(50),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("skills", () => {
    it("requires at least one skill", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        skills: [],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("at least one required skill"))).toBe(true);
    });

    it("rejects empty skill strings after trim", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        skills: ["   "],
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("at least 1 character"))).toBe(true);
    });

    it("accepts an array with a valid skill", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        skills: ["React"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("budgetUsdc", () => {
    it("rejects budgets below 100", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        budgetUsdc: 50,
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("Minimum budget"))).toBe(true);
    });

    it("rejects budgets above 1,000,000", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        budgetUsdc: 2_000_000,
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("Maximum budget"))).toBe(true);
    });

    it("accepts boundary values", () => {
      expect(postJobSchema.safeParse({ ...baseValid, budgetUsdc: 100 }).success).toBe(true);
      expect(postJobSchema.safeParse({ ...baseValid, budgetUsdc: 1_000_000 }).success).toBe(true);
    });
  });

  describe("deadline", () => {
    it("rejects past dates", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        deadline: "2020-01-01",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("in the future"))).toBe(true);
    });

    it("accepts future dates", () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const result = postJobSchema.safeParse({
        ...baseValid,
        deadline: future.toISOString().slice(0, 10),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("paymentType + milestones", () => {
    it("requires milestones when paymentType is milestone", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        paymentType: "milestone",
        milestones: undefined,
      });
      expect(result.success).toBe(false);
      expect(result.error.issues.some((i) => i.message.includes("Milestones are required"))).toBe(true);
    });

    it("accepts fixed payment without milestones field", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        paymentType: "fixed",
      });
      expect(result.success).toBe(true);
    });

    it("accepts milestone payment with valid milestones count", () => {
      const result = postJobSchema.safeParse({
        ...baseValid,
        paymentType: "milestone",
        milestones: 3,
      });
      expect(result.success).toBe(true);
    });
  });
});

// ── Component tests ────────────────────────────────────────────────────────────

describe("PostJobForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    usePostJobMock.mockReset();
  });

  it("renders all required form fields", () => {
    renderForm();
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scope/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required skills/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/budget \(usdc\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/payment type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/deadline/i)).toBeInTheDocument();
  });

  it("shows validation errors on empty submit", async () => {
    renderForm();
    fireEvent.click(screen.getByTestId("submit-job-btn"));
    await waitFor(() => {
      expect(screen.getByText(/title must be at least 5 characters/i)).toBeInTheDocument();
    });
  });

  it("adds and removes skills correctly", async () => {
    renderForm();
    const skillInput = screen.getByTestId("skill-input");

    fireEvent.change(skillInput, { target: { value: "React" } });
    expect(skillInput).toHaveValue("React");

    // Wait for button to become enabled
    await waitFor(() => {
      const addBtn = screen.getByTestId("add-skill-btn");
      expect(addBtn).not.toBeDisabled();
    });

    const addBtn = screen.getByTestId("add-skill-btn");
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByTestId("skill-tag-react")).toBeInTheDocument();
    });

    const removeBtn = screen.getByTestId("remove-skill-react");
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("skill-tag-react")).not.toBeInTheDocument();
    });
  });

  it("shows milestones field only when payment type is milestone", () => {
    renderForm();
    expect(screen.getByTestId("milestones-input")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("payment-type-select"), { target: { value: "fixed" } });
    expect(screen.queryByTestId("milestones-input")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("payment-type-select"), { target: { value: "milestone" } });
    expect(screen.getByTestId("milestones-input")).toBeInTheDocument();
  });

  it("disables all inputs during submission", () => {
    renderForm({ isSubmitting: true });

    expect(screen.getByTestId("job-title-input")).toBeDisabled();
    expect(screen.getByTestId("budget-input")).toBeDisabled();
    expect(screen.getByTestId("submit-job-btn")).toBeDisabled();
  });

  it("calls submit with correct data on valid form", async () => {
    const { mockUsePostJob } = renderForm();

    fireEvent.change(screen.getByTestId("job-title-input"), {
      target: { value: "Build a Smart Contract" },
    });

    // Fill a valid description (>50 chars)
    fireEvent.change(screen.getByTestId("job-description-textarea"), {
      target: { value: "A".repeat(60) },
    });

    // Add skill
    const skillInput = screen.getByTestId("skill-input");
    fireEvent.change(skillInput, { target: { value: "Soroban" } });
    const addBtn = screen.getByTestId("add-skill-btn");
    fireEvent.click(addBtn);

    // Set budget
    fireEvent.change(screen.getByTestId("budget-input"), { target: { value: "5000" } });

    // Ensure date is future (default is already valid)

    // Submit
    fireEvent.click(screen.getByTestId("submit-job-btn"));

    await waitFor(() => {
      expect(mockUsePostJob.mock.results[0].value.submit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Build a Smart Contract",
          budgetUsdc: 5000 * 10_000_000,
          milestones: 1,
          estimatedCompletionDate: expect.any(String),
        }),
      );
    });
  });

  it("displays real-time validation feedback", async () => {
    renderForm();
    const titleInput = screen.getByTestId("job-title-input");

    fireEvent.change(titleInput, { target: { value: "Hi" } });
    await waitFor(() => {
      expect(screen.getByText(/title must be at least 5 characters/i)).toBeInTheDocument();
    });

    fireEvent.change(titleInput, { target: { value: "Valid Title for Job" } });
    await waitFor(() => {
      expect(screen.queryByText(/title must be at least 5 characters/i)).not.toBeInTheDocument();
    });
  });
});

// ── Edge case tests ────────────────────────────────────────────────────────────

describe("PostJobForm edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderForm();
  });

  it("limits maximum skills to 10", async () => {
    const skillInput = screen.getByTestId("skill-input");

    for (let i = 0; i < 10; i++) {
      fireEvent.change(skillInput, { target: { value: `skill${i}` } });
      let addBtn = screen.getByTestId("add-skill-btn");
      // Ensure button enabled before clicking? It should be enabled after input has value.
      await waitFor(() => {
        expect(addBtn).not.toBeDisabled();
      });
      fireEvent.click(addBtn);
    }

    await waitFor(() => {
      expect(screen.getByText("10/10 skills added")).toBeInTheDocument();
    });
    expect(screen.getByTestId("add-skill-btn")).toBeDisabled();
  });

  it("prevents adding duplicate skills", async () => {
    const skillInput = screen.getByTestId("skill-input");

    fireEvent.change(skillInput, { target: { value: "React" } });
    let addBtn = screen.getByTestId("add-skill-btn");
    await waitFor(() => expect(addBtn).not.toBeDisabled());
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByTestId("skill-tag-react")).toBeInTheDocument();
    });

    fireEvent.change(skillInput, { target: { value: "React" } });
    addBtn = screen.getByTestId("add-skill-btn");
    await waitFor(() => expect(addBtn).not.toBeDisabled());
    fireEvent.click(addBtn);

    await waitFor(() => {
      const tags = screen.getAllByTestId(/^skill-tag-/i);
      expect(tags).toHaveLength(1);
    });
  });
});
