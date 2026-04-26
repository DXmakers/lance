import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useTheme } from "next-themes";
import { ThemeToggle } from "@/components/theme/theme-toggle";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(),
}));

const mockUseTheme = vi.mocked(useTheme);

describe("ThemeToggle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("switches to light mode when current theme is dark", () => {
    const setTheme = vi.fn();

    mockUseTheme.mockReturnValue({
      resolvedTheme: "dark",
      setTheme,
      theme: "dark",
      systemTheme: "dark",
      themes: ["light", "dark", "system"],
      forcedTheme: undefined,
    });

    const { getByRole } = render(<ThemeToggle />);

    getByRole("button").click();

    expect(setTheme).toHaveBeenCalledWith("light");
  });

  it("switches to dark mode when current theme is light", () => {
    const setTheme = vi.fn();

    mockUseTheme.mockReturnValue({
      resolvedTheme: "light",
      setTheme,
      theme: "light",
      systemTheme: "light",
      themes: ["light", "dark", "system"],
      forcedTheme: undefined,
    });

    const { getByRole } = render(<ThemeToggle />);

    getByRole("button").click();

    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
