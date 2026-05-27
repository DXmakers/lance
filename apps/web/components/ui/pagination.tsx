import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  className?: string;
}

interface PageButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: "default" | "ghost";
}

function PageButton({
  active,
  variant = "ghost",
  className,
  disabled,
  children,
  ...props
}: PageButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-amber-500 text-white hover:bg-amber-600"
          : variant === "ghost"
          ? "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-950",
        className
      )}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      tabIndex={disabled ? -1 : 0}
      {...props}
    >
      {children}
    </button>
  );
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [6, 12, 18, 24],
  showPageSizeSelector = true,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const getPageNumbers = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = [];
    const delta = 2;

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - delta && i <= currentPage + delta)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "ellipsis") {
        pages.push("ellipsis");
      }
    }

    return pages;
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    targetPage: number
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPageChange(targetPage);
    }
  };

  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-sm transition-colors duration-150",
        className
      )}
      aria-label="Pagination navigation"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">
          Page <span className="text-slate-900">{currentPage}</span> of{" "}
          <span className="text-slate-900">{totalPages}</span>
        </span>
      </div>

      <div className="flex items-center gap-1" role="list" aria-label="Page numbers">
        <PageButton
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          aria-label="Go to first page"
          tabIndex={0}
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
        </PageButton>

        <PageButton
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Go to previous page"
          tabIndex={0}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </PageButton>

        <div className="mx-2 flex items-center gap-1">
          {getPageNumbers().map((pageNum, idx) =>
            pageNum === "ellipsis" ? (
              <span
                key={`ellipsis-${idx}`}
                className="flex h-9 min-w-[2.25rem] items-center justify-center px-3 text-sm text-slate-400"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <PageButton
                key={pageNum}
                active={pageNum === currentPage}
                onClick={() => onPageChange(pageNum)}
                onKeyDown={(e) => handleKeyDown(e, pageNum)}
                aria-label={`Go to page ${pageNum}`}
                aria-current={pageNum === currentPage ? "page" : undefined}
                tabIndex={0}
              >
                {pageNum}
              </PageButton>
            )
          )}
        </div>

        <PageButton
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Go to next page"
          tabIndex={0}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </PageButton>

        <PageButton
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Go to last page"
          tabIndex={0}
        >
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </PageButton>
      </div>

      {showPageSizeSelector && onPageSizeChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Show</span>
          <div className="flex gap-1" role="list" aria-label="Page size options">
            {pageSizeOptions.map((size) => (
              <PageButton
                key={size}
                active={pageSize === size}
                onClick={() => onPageSizeChange(size)}
                aria-label={`Show ${size} jobs per page`}
                tabIndex={0}
              >
                {size}
              </PageButton>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
