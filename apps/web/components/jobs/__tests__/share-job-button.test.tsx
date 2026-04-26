import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ShareJobButton } from "@/components/jobs/share-job-button";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("ShareJobButton", () => {
  beforeEach(() => {
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("uses navigator.share when available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareMock,
    });

    render(<ShareJobButton path="/jobs/123" title="SDK Integration" />);

    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "SDK Integration",
          url: expect.stringContaining("/jobs/123"),
        }),
      );
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });

  it("falls back to clipboard copy when share API is unavailable", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    render(<ShareJobButton path="/jobs/abc" />);

    fireEvent.click(screen.getByRole("button", { name: "Share this job" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining("/jobs/abc"),
      );
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });
});
