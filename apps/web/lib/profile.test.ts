import type { PublicProfile } from "@/lib/api";
import {
  createProfileFormValues,
  getLedgerStatusTone,
  normalizePortfolioLinks,
  validateProfileForm,
} from "@/lib/profile";

const baseProfile: PublicProfile = {
  address: "GABCDEFGHIJKLMNOPQRSTUVXYZ1234567890ABCDEF",
  display_name: "Amina",
  headline: "Soroban product designer and delivery strategist",
  bio: "I design Web3 product flows with strong UX systems, measurable trust signals, and responsive execution across the full job lifecycle.",
  portfolio_links: ["https://amina.dev", "https://dribbble.com/amina"],
  updated_at: "2026-04-24T12:00:00.000Z",
  metrics: {
    total_jobs: 12,
    completed_jobs: 10,
    active_jobs: 2,
    disputed_jobs: 1,
    verified_volume_usdc: 750000000,
    completion_rate: 0.83,
    dispute_rate: 0.08,
  },
  history: [],
};

describe("profile helpers", () => {
  it("creates form defaults from a public profile", () => {
    expect(createProfileFormValues(baseProfile)).toEqual({
      displayName: "Amina",
      headline: "Soroban product designer and delivery strategist",
      bio: baseProfile.bio,
      portfolioLinks: "https://amina.dev\nhttps://dribbble.com/amina",
    });
  });

  it("normalizes and de-duplicates portfolio links", () => {
    expect(
      normalizePortfolioLinks(
        " https://amina.dev \nhttps://dribbble.com/amina\nhttps://amina.dev\n\n",
      ),
    ).toEqual(["https://amina.dev", "https://dribbble.com/amina"]);
  });

  it("returns a clean update payload for valid form data", () => {
    const result = validateProfileForm({
      displayName: " Amina O. ",
      headline: "Senior Web3 product designer for escrow marketplaces",
      bio: "I build highly accessible hiring and payment experiences that feel calm, fast, and trustworthy for global freelance teams.",
      portfolioLinks: "https://amina.dev\nhttps://github.com/amina",
    });

    expect(result.errors).toEqual({});
    expect(result.data).toEqual({
      display_name: "Amina O.",
      headline: "Senior Web3 product designer for escrow marketplaces",
      bio: "I build highly accessible hiring and payment experiences that feel calm, fast, and trustworthy for global freelance teams.",
      portfolio_links: ["https://amina.dev", "https://github.com/amina"],
    });
  });

  it("surfaces field errors for invalid profile input", () => {
    const result = validateProfileForm({
      displayName: "A".repeat(49),
      headline: "Too short",
      bio: "Too short for the required bio length.",
      portfolioLinks: "not-a-url",
    });

    expect(result.data).toBeNull();
    expect(result.errors.displayName).toContain("48 characters");
    expect(result.errors.headline).toContain("at least 12 characters");
    expect(result.errors.bio).toContain("at least 40 characters");
    expect(result.errors.portfolioLinks).toContain("valid URL");
  });

  it("maps ledger statuses to high-contrast tones", () => {
    expect(getLedgerStatusTone("completed")).toContain("emerald");
    expect(getLedgerStatusTone("awaiting_funding")).toContain("amber");
    expect(getLedgerStatusTone("disputed")).toContain("rose");
    expect(getLedgerStatusTone("something-else")).toContain("zinc");
  });
});
