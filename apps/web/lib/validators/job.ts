import { z } from "zod";

export const jobCreateSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(20, "Description must be at least 20 characters"),
  budget_usdc: z.number().min(1000, "Budget must be at least 1000 (in USDC base units)"),
  milestones: z.number().min(1),
  client_address: z.string().min(10),
});

export type JobCreate = z.infer<typeof jobCreateSchema>;
