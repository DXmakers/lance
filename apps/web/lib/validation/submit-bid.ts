import { z } from "zod";

export const submitBidSchema = z.object({
  proposal: z
    .string()
    .trim()
    .min(80, "Proposal must be at least 80 characters.")
    .max(2000, "Proposal must be 2000 characters or less."),
  timelineDays: z
    .number({ error: "Timeline is required." })
    .int("Timeline must be a whole number of days.")
    .min(1, "Timeline must be at least 1 day.")
    .max(365, "Timeline must be 365 days or fewer."),
  milestoneSummary: z
    .string()
    .trim()
    .min(20, "Milestone summary must be at least 20 characters.")
    .max(300, "Milestone summary must be 300 characters or less."),
});

export type SubmitBidInput = z.infer<typeof submitBidSchema>;

export function buildBidProposalPayload(input: SubmitBidInput): string {
  return [
    input.proposal.trim(),
    `Timeline: ${input.timelineDays} days`,
    `Milestones: ${input.milestoneSummary.trim()}`,
  ].join("\n\n");
}
