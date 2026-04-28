import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Pagination } from "@/components/ui/pagination";

describe("Pagination", () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 5,
    onPageChange: vi.fn(),
  };

  it("renders navigation with correct aria-label", () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByRole("navigation", { name: /pagination navigation/i })).toBeInTheDocument();
  });

  it("displays current page and total pages", () => {
    render(<Pagination {...defaultProps} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(/page.*5/i)).toBeInTheDocument();
  });

  it("renders correct number of page buttons (excluding ellipsis)", () => {
    render(<Pagination {...defaultProps} />);
    // Pages: 1,2,3,4,5 (since totalPages=5 and current=1, all fit within delta=2)
    const pageButtons = screen.getAllByRole("button", { name: /go to page \d/i });
    expect(pageButtons.length).toBe(5);
  });

  it("first and previous buttons are disabled on first page", () => {
    render(<Pagination {...defaultProps} currentPage={1} />);
    const firstBtn = screen.getByLabelText(/go to first page/i);
    const prevBtn = screen.getByLabelText(/go to previous page/i);
    expect(firstBtn).toBeDisabled();
    expect(prevBtn).toBeDisabled();
  });

  it("next and last buttons are disabled on last page", () => {
    render(<Pagination {...defaultProps} currentPage={5} />);
    const nextBtn = screen.getByLabelText(/go to next page/i);
    const lastBtn = screen.getByLabelText(/go to last page/i);
    expect(nextBtn).toBeDisabled();
    expect(lastBtn).toBeDisabled();
  });

  it("calls onPageChange when a page button is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText(/go to page 3/i));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange when next button is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} currentPage={2} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText(/go to next page/i));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange when previous button is clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} currentPage={3} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText(/go to previous page/i));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange when first/last buttons are clicked", () => {
    const onPageChange = vi.fn();
    render(<Pagination {...defaultProps} currentPage={3} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText(/go to first page/i));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByLabelText(/go to last page/i));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("renders ellipsis when totalPages > 5", () => {
    render(<Pagination {...defaultProps} totalPages={10} currentPage={1} />);
    // Pages expected: 1,2,3, ..., 9,10
    const ellipses = screen.getAllByText("…");
    expect(ellipses.length).toBeGreaterThan(0);
  });

  it("highlights the active page button", () => {
    render(<Pagination {...defaultProps} currentPage={3} />);
    const activeBtn = screen.getByLabelText(/go to page 3/i);
    expect(activeBtn).toHaveAttribute("aria-current", "page");
    expect(activeBtn).toHaveClass("bg-amber-500");
  });

  it("page size selector renders when enabled and calls onPageSizeChange", () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        {...defaultProps}
        pageSize={6}
        onPageSizeChange={onPageSizeChange}
        showPageSizeSelector
      />
    );

    expect(screen.getByText("Show")).toBeInTheDocument();
    const options = screen.getAllByRole("button", { name: /show \d+ jobs per page/i });
    expect(options).toHaveLength(4); // default options: 6,12,18,24

    fireEvent.click(screen.getByLabelText(/show 12 jobs per page/i));
    expect(onPageSizeChange).toHaveBeenCalledWith(12);
  });

  it("page size selector highlights current size", () => {
    render(<Pagination {...defaultProps} pageSize={12} showPageSizeSelector />);
    const btn = screen.getByLabelText(/show 12 jobs per page/i);
    expect(btn).toHaveAttribute("aria-current", "page");
    expect(btn).toHaveClass("bg-amber-500");
  });

  it("does not render when totalPages is 0 or 1", () => {
    const { container: container0 } = render(<Pagination {...defaultProps} totalPages={0} />);
    expect(container0.firstChild).toBeNull();

    const { container: container1 } = render(<Pagination {...defaultProps} totalPages={1} />);
    expect(container1.firstChild).toBeNull();
  });

  it("has proper aria attributes for accessibility", () => {
    render(<Pagination {...defaultProps} />);
    const nav = screen.getByRole("navigation");
    expect(nav).toHaveAttribute("aria-label", "Pagination navigation");

    const list = screen.getByRole("list", { name: /page numbers/i });
    expect(list).toBeInTheDocument();
  });
});
