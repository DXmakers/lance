import { z } from "zod";
import type { PublicProfile, UpdateProfileBody } from "@/lib/api";

export type ProfileTabId = "overview" | "history" | "reliability";

export interface ProfileFormValues {
  displayName: string;
  headline: string;
  bio: string;
  portfolioLinks: string;
}

export type ProfileFormErrors = Partial<Record<keyof ProfileFormValues, string>>;

const displayNameSchema = z
  .string()
  .trim()
  .max(48, "Display name must be 48 characters or fewer.");

const headlineSchema = z
  .string()
  .trim()
  .min(12, "Headline must be at least 12 characters.")
  .max(96, "Headline must be 96 characters or fewer.");

const bioSchema = z
  .string()
  .trim()
  .min(40, "Bio must be at least 40 characters.")
  .max(600, "Bio must be 600 characters or fewer.");

export const profileFormSchema = z
  .object({
    displayName: displayNameSchema,
    headline: headlineSchema,
    bio: bioSchema,
    portfolioLinks: z
      .string()
      .max(1200, "Portfolio links must stay under 1,200 characters."),
  })
  .superRefine((value, ctx) => {
    const links = normalizePortfolioLinks(value.portfolioLinks);

    if (links.length > 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["portfolioLinks"],
        message: "Add up to 6 portfolio links.",
      });
    }

    links.forEach((link, index) => {
      const result = z.string().url().safeParse(link);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["portfolioLinks"],
          message: `Link ${index + 1} must be a valid URL.`,
        });
      }
    });
  });

export function createProfileFormValues(profile: PublicProfile): ProfileFormValues {
  return {
    displayName: profile.display_name ?? "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    portfolioLinks: profile.portfolio_links.join("\n"),
  };
}

export function normalizePortfolioLinks(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function validateProfileForm(values: ProfileFormValues): {
  data: UpdateProfileBody | null;
  errors: ProfileFormErrors;
} {
  const parsed = profileFormSchema.safeParse(values);

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    return {
      data: null,
      errors: {
        displayName: flattened.displayName?.[0],
        headline: flattened.headline?.[0],
        bio: flattened.bio?.[0],
        portfolioLinks: flattened.portfolioLinks?.[0],
      },
    };
  }

  return {
    data: {
      display_name: parsed.data.displayName.trim() || undefined,
      headline: parsed.data.headline.trim(),
      bio: parsed.data.bio.trim(),
      portfolio_links: normalizePortfolioLinks(parsed.data.portfolioLinks),
    },
    errors: {},
  };
}

export function getLedgerStatusTone(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
    case "released":
    case "paid":
      return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200";
    case "pending":
    case "awaiting_funding":
    case "in_progress":
      return "border-amber-500/30 bg-amber-500/12 text-amber-100";
    case "disputed":
    case "cancelled":
      return "border-rose-500/30 bg-rose-500/12 text-rose-100";
    default:
      return "border-white/10 bg-white/5 text-zinc-200";
  }
}
