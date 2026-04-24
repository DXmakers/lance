import {
  buildBidProposalPayload,
  submitBidSchema,
} from "@/lib/validation/submit-bid";

describe("submitBidSchema", () => {
  it("accepts valid bid input", () => {
    const parsed = submitBidSchema.safeParse({
      proposal:
        "I have delivered multiple marketplace dashboards and can complete this with typed API integrations and test coverage.",
      timelineDays: 12,
      milestoneSummary: "Wireframes first, then implementation and QA handoff.",
    });

    expect(parsed.success).toBe(true);
  });

  it("returns strict field errors for invalid values", () => {
    const parsed = submitBidSchema.safeParse({
      proposal: "too short",
      timelineDays: 0,
      milestoneSummary: "short",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected parse to fail");
    }

    const errors = parsed.error.flatten().fieldErrors;
    expect(errors.proposal?.[0]).toContain("at least 80");
    expect(errors.timelineDays?.[0]).toContain("at least 1");
    expect(errors.milestoneSummary?.[0]).toContain("at least 20");
  });

  it("builds a normalized API payload", () => {
    const payload = buildBidProposalPayload({
      proposal: "  Proposal body ",
      timelineDays: 21,
      milestoneSummary: "  Discovery, build, and final QA  ",
    });

    expect(payload).toBe(
      "Proposal body\n\nTimeline: 21 days\n\nMilestones: Discovery, build, and final QA",
    );
  });
});
