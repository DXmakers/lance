/**
 * StatusBadge Component Tests
 * 
 * Tests to ensure status badges render correct colors based on data inputs
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../status-badge";

describe("StatusBadge", () => {
  // ─── Color Rendering Tests ──────────────────────────────────────────────

  it("renders success badge with emerald color", () => {
    const { container } = render(<StatusBadge status="success" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("badge-success");
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("renders pending badge with amber color", () => {
    const { container } = render(<StatusBadge status="pending" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("badge-warning");
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders error badge with red color", () => {
    const { container } = render(<StatusBadge status="error" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("badge-error");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders info badge with blue color", () => {
    const { container } = render(<StatusBadge status="info" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("badge-info");
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("renders active badge with emerald color", () => {
    const { container } = render(<StatusBadge status="active" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("badge-success");
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  // ─── Custom Label Tests ─────────────────────────────────────────────────

  it("renders custom label when provided", () => {
    render(<StatusBadge status="success" label="Custom Label" />);
    
    expect(screen.getByText("Custom Label")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  // ─── Icon Tests ─────────────────────────────────────────────────────────

  it("renders icon by default", () => {
    const { container } = render(<StatusBadge status="success" />);
    const icon = container.querySelector("svg");
    
    expect(icon).toBeInTheDocument();
  });

  it("hides icon when showIcon is false", () => {
    const { container } = render(<StatusBadge status="success" showIcon={false} />);
    const icon = container.querySelector("svg");
    
    expect(icon).not.toBeInTheDocument();
  });

  // ─── Size Tests ─────────────────────────────────────────────────────────

  it("applies small size classes", () => {
    const { container } = render(<StatusBadge status="success" size="sm" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("text-[10px]");
  });

  it("applies medium size classes by default", () => {
    const { container } = render(<StatusBadge status="success" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("text-xs");
  });

  it("applies large size classes", () => {
    const { container } = render(<StatusBadge status="success" size="lg" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("text-sm");
  });

  // ─── Custom ClassName Tests ─────────────────────────────────────────────

  it("applies custom className", () => {
    const { container } = render(
      <StatusBadge status="success" className="custom-class" />
    );
    const badge = container.firstChild as HTMLElement;
    
    expect(badge).toHaveClass("custom-class");
  });

  // ─── Accessibility Tests ────────────────────────────────────────────────

  it("renders as a span element", () => {
    const { container } = render(<StatusBadge status="success" />);
    const badge = container.firstChild as HTMLElement;
    
    expect(badge.tagName).toBe("SPAN");
  });

  // ─── High-Contrast Color Validation ─────────────────────────────────────

  it("uses high-contrast emerald for success states", () => {
    const { container } = render(<StatusBadge status="success" />);
    const badge = container.firstChild as HTMLElement;
    
    // Verify it uses the badge-success class which has emerald colors
    expect(badge).toHaveClass("badge-success");
  });

  it("uses high-contrast amber for pending states", () => {
    const { container } = render(<StatusBadge status="pending" />);
    const badge = container.firstChild as HTMLElement;
    
    // Verify it uses the badge-warning class which has amber colors
    expect(badge).toHaveClass("badge-warning");
  });

  // ─── Multiple Status Tests ──────────────────────────────────────────────

  it("renders different statuses correctly in sequence", () => {
    const statuses: Array<"success" | "pending" | "error"> = ["success", "pending", "error"];
    
    statuses.forEach((status) => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const badge = container.firstChild as HTMLElement;
      
      if (status === "success") {
        expect(badge).toHaveClass("badge-success");
      } else if (status === "pending") {
        expect(badge).toHaveClass("badge-warning");
      } else if (status === "error") {
        expect(badge).toHaveClass("badge-error");
      }
      
      unmount();
    });
  });
});
