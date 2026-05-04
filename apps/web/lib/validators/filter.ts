import { z } from "zod";

export const jobFilterSchema = z.object({
  query: z.string().optional(),
  activeTag: z.string().default("all"),
  sortBy: z.enum(["budget", "chronological", "reputation"]).default("chronological"),
  minBudget: z.number().min(0).optional(),
  maxBudget: z.number().min(0).optional(),
  status: z.enum(["all", "open", "pending", "in_progress", "completed"]).default("all"),
});

export type JobFilter = z.infer<typeof jobFilterSchema>;
