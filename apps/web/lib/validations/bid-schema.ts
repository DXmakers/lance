"use client";

import { z } from "zod";

export const bidSchema = z.object({
  proposal: z
    .string()
    .trim()
    .min(24, "Proposal must be at least 24 characters.")
    .max(2000, "Proposal must be 2,000 characters or fewer."),
});

export type BidFormData = z.infer<typeof bidSchema>;


