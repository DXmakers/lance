import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BidStatusBadge, BidStatusIndicator } from "../bid-status-badge";

describe("BidStatusBadge Component", () => {
  describe("Rendering", () => {
    it("should render pending status with correct styling", () => {
      render(<BidStatusBadge status="pending" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("Pending");
      expect(badge).toHaveClass("text-amber-500", "bg-amber-500/10");
    });

    it("should render accepted status with correct styling", () => {
      render(<BidStatusBadge status="accepted" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("Accepted");
      expect(badge).toHaveClass("text-emerald-500", "bg-emerald-500/10");
    });

    it("should render rejected status with correct styling", () => {
      render(<BidStatusBadge status="rejected" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveTextContent("Rejected");
      expect(badge).toHaveClass("text-red-500", "bg-red-500/10");
    });
  });

  describe("Animations", () => {
    it("should apply pulse animation when animated prop is true", () => {
      render(<BidStatusBadge status="pending" animated />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveClass("animate-pulse");
    });

    it("should not apply pulse animation by default", () => {
      render(<BidStatusBadge status="pending" />);
      const badge = screen.getByRole("status");
      expect(badge).not.toHaveClass("animate-pulse");
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA attributes", () => {
      render(<BidStatusBadge status="accepted" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveAttribute(
        "aria-label",
        "Bid Accepted: Bid selected for this job",
      );
    });

    it("should have accessible icon descriptions", () => {
      render(<BidStatusBadge status="pending" />);
      const badge = screen.getByRole("status");
      expect(badge.querySelector("svg")).toBeInTheDocument();
    });
  });

  describe("Styling", () => {
    it("should accept custom className", () => {
      render(<BidStatusBadge status="pending" className="custom-class" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveClass("custom-class");
    });

    it("should have transition classes for smooth interactions", () => {
      render(<BidStatusBadge status="pending" />);
      const badge = screen.getByRole("status");
      expect(badge).toHaveClass("transition-all", "duration-150");
    });
  });
});

describe("BidStatusIndicator Component", () => {
  describe("Rendering", () => {
    it("should render status badge", () => {
      render(<BidStatusIndicator status="pending" />);
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("should render timestamp when provided", () => {
      render(
        <BidStatusIndicator
          status="accepted"
          timestamp="2 hours ago"
        />,
      );
      expect(screen.getByText(/Updated 2 hours ago/)).toBeInTheDocument();
    });

    it("should not render timestamp section when not provided", () => {
      const { container } = render(
        <BidStatusIndicator status="rejected" />,
      );
      const timestampText = container.textContent?.match(/Updated/);
      expect(timestampText).toBeNull();
    });
  });

  describe("Styling", () => {
    it("should apply status-specific colors", () => {
      render(<BidStatusIndicator status="accepted" />);
      const container = screen.getByText("Accepted").parentElement;
      expect(container).toHaveClass("bg-emerald-500/10", "border-emerald-500/20");
    });

    it("should accept custom className", () => {
      render(
        <BidStatusIndicator
          status="pending"
          className="custom-indicator"
        />,
      );
      const container = screen.getByText("Pending").closest("div");
      expect(container).toHaveClass("custom-indicator");
    });
  });
});
