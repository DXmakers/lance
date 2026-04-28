"use client";

import { z } from "zod";

export const postJobSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters.")
    .max(100, "Title must be 100 characters or fewer."),
  description: z
    .string()
    .trim()
    .min(50, "Description must be at least 50 characters.")
    .max(5000, "Description must be 5,000 characters or fewer."),
  skills: z.array(z.string().trim().min(1, "Skill must be at least 1 character.")).min(1, "Add at least one required skill."),
  budgetUsdc: z.number().min(100, "Minimum budget is 100 USDC.").max(1_000_000, "Maximum budget is 1,000,000 USDC."),
  deadline: z.string().refine(
    (date) => new Date(date) > new Date(),
    { message: "Deadline must be in the future." },
  ),
  paymentType: z.enum(["fixed", "milestone"], {
    errorMap: (issue, ctx) => ({
      message: "Select a payment type.",
    }),
  }),
  milestones: z.number().min(1, "At least 1 milestone required.").max(20, "Maximum 20 milestones.").optional(),
}).refine(
  (data) => {
    if (data.paymentType === "milestone") {
      return data.milestones !== undefined && data.milestones >= 1;
    }
    return true;
  },
  {
    message: "Milestones are required for milestone payments.",
    path: ["milestones"],
  },
);

export type PostJobFormData = z.infer<typeof postJobSchema>;
