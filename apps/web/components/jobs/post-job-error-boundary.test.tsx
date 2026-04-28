import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { PostJobErrorBoundary } from "./post-job-error-boundary";

// Module-scoped flag to ensure child throws only once across mounts
let hasThrownOnce = false;

describe("PostJobErrorBoundary", () => {
  beforeEach(() => {
    hasThrownOnce = false;
  });

  it("renders children when no error", () => {
    render(
      <PostJobErrorBoundary>
        <div data-testid="child">Hello</div>
      </PostJobErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    const Throwing = () => {
      throw new Error("Test error");
    };

    render(
      <PostJobErrorBoundary>
        <Throwing />
      </PostJobErrorBoundary>,
    );

    expect(screen.getByText("Job posting unavailable")).toBeInTheDocument();
    expect(screen.getByText(/we could not render the job posting form/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry job form/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument();
  });

  it("retry button resets error state and re-renders children after recovery", async () => {
    // Child that throws only on its first mount ever
    const OnceThrowing = () => {
      if (!hasThrownOnce) {
        hasThrownOnce = true;
        throw new Error("First render error");
      }
      return <div data-testid="recovered">Recovered content</div>;
    };

    render(
      <PostJobErrorBoundary>
        <OnceThrowing />
      </PostJobErrorBoundary>,
    );

    // Error UI shown initially
    expect(screen.getByText("Job posting unavailable")).toBeInTheDocument();

    // Click retry - this resets the boundary's error state
    fireEvent.click(screen.getByRole("button", { name: /retry job form/i }));

    // The child will now render without throwing
    await waitFor(() => {
      expect(screen.getByTestId("recovered")).toBeInTheDocument();
      expect(screen.getByText("Recovered content")).toBeInTheDocument();
    });
  });
});
