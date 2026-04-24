import { z } from "zod";

export const BidFormSchema = z.object({
  proposal: z
    .string()
    .min(50, "Proposal must be at least 50 characters long")
    .max(5000, "Proposal is too long"),
});

export type BidFormData = z.infer<typeof BidFormSchema>;

export const DeliverableFormSchema = z.object({
  label: z.string().min(3, "Title must be at least 3 characters").max(100),
  url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  file: z.instanceof(File).optional(),
}).refine(data => data.url || data.file, {
  message: "Either a link or a file must be provided",
  path: ["url"],
});

export type DeliverableFormData = z.infer<typeof DeliverableFormSchema>;
