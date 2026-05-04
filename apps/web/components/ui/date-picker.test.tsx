import { describe, it, expect } from "vitest";
import { datePickerSchema } from "./date-picker";

describe("datePickerSchema", () => {
  it("should fail if date is missing", () => {
    const result = datePickerSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should fail if date is in the past", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const result = datePickerSchema.safeParse({ date: pastDate });
    expect(result.success).toBe(false);
  });

  it("should succeed if date is in the future", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const result = datePickerSchema.safeParse({ date: futureDate });
    expect(result.success).toBe(true);
  });
});
