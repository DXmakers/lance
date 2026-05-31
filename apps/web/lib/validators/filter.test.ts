import { describe, it, expect } from "vitest";
import { jobFilterSchema } from "./filter";

describe("jobFilterSchema", () => {
  it("should validate a correct filter object", () => {
    const validFilter = {
      query: "react",
      activeTag: "frontend",
      sortBy: "budget",
      minBudget: 100,
      maxBudget: 1000,
      status: "open"
    };
    const result = jobFilterSchema.safeParse(validFilter);
    expect(result.success).toBe(true);
  });

  it("should use default values for missing optional fields", () => {
    const partialFilter = {};
    const result = jobFilterSchema.safeParse(partialFilter);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activeTag).toBe("all");
      expect(result.data.sortBy).toBe("chronological");
      expect(result.data.status).toBe("all");
    }
  });

  it("should fail on invalid sortBy value", () => {
    const invalidFilter = { sortBy: "invalid" };
    const result = jobFilterSchema.safeParse(invalidFilter);
    expect(result.success).toBe(false);
  });
});
