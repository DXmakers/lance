import { z } from "zod";

export const JobStatusSchema = z.enum(["open", "pending", "completed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  budget: z.number(), // budget_usdc from API
  status: JobStatusSchema,
  escrowId: z.number().optional(), // on_chain_job_id from API
  employerAddress: z.string(), // client_address from API
  created_at: z.string(),
  updated_at: z.string(),
});

export type Job = z.infer<typeof JobSchema>;

export const ReputationMetricsSchema = z.object({
  scoreBps: z.number(),
  totalJobs: z.number(),
  totalPoints: z.number(),
  reviews: z.number(),
  starRating: z.number(),
  averageStars: z.number(),
});

export const BoardJobSchema = JobSchema.extend({
  tags: z.array(z.string()),
  deadlineAt: z.string(),
  clientReputation: ReputationMetricsSchema,
});

export type BoardJob = z.infer<typeof BoardJobSchema>;

export const JobFiltersSchema = z.object({
  category: z.string().optional(),
  minBudget: z.number().optional(),
  maxBudget: z.number().optional(),
  escrowStatus: z.string().optional(),
  status: JobStatusSchema.optional(),
});

export type JobFilters = z.infer<typeof JobFiltersSchema>;
