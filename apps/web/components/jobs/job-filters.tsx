"use client";

import { 
  Filter, 
  Search, 
  SlidersHorizontal, 
  Clock3, 
  TrendingUp, 
  Shield,
  ChevronDown,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface JobFiltersProps {
  query: string;
  setQuery: (q: string) => void;
  activeTag: string;
  setActiveTag: (tag: string) => void;
  sortBy: "budget" | "chronological" | "reputation";
  setSortBy: (sort: "budget" | "chronological" | "reputation") => void;
  availableTags: string[];
  minBudget: number | undefined;
  setMinBudget: (val: number | undefined) => void;
  maxBudget: number | undefined;
  setMaxBudget: (val: number | undefined) => void;
  filterStatus: string;
  setFilterStatus: (status: string) => void;
}

const SORT_OPTIONS = [
  { id: "chronological", label: "Newest", icon: Clock3 },
  { id: "budget", label: "Top Budget", icon: TrendingUp },
  { id: "reputation", label: "Best Client", icon: Shield },
] as const;

const STATUS_OPTIONS = [
  { id: "all", label: "All Statuses" },
  { id: "open", label: "Open" },
  { id: "pending", label: "Pending" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
];

export function JobFilters({
  query,
  setQuery,
  activeTag,
  setActiveTag,
  sortBy,
  setSortBy,
  availableTags,
  minBudget,
  setMinBudget,
  maxBudget,
  setMaxBudget,
  filterStatus,
  setFilterStatus,
}: JobFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section
      aria-label="Filter and sort jobs"
      className={cn(
        "rounded-3xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-md sm:p-6",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] transition-all duration-300"
      )}
    >
      <div className="flex flex-col gap-6">
        {/* Primary Row: Search & Status */}
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
          {/* Search Input */}
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-indigo-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, stack, or client wallet..."
              className={cn(
                "w-full bg-zinc-950/50 border border-zinc-800 rounded-2xl py-3 pl-11 pr-10 text-sm text-zinc-200 outline-none",
                "transition-all duration-200 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 placeholder:text-zinc-600"
              )}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-800 rounded-md transition-colors"
              >
                <X className="h-3 w-3 text-zinc-500" />
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="relative min-w-[160px]">
             <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={cn(
                "w-full appearance-none bg-zinc-950/50 border border-zinc-800 rounded-2xl py-3 pl-4 pr-10 text-sm text-zinc-300 outline-none",
                "transition-all duration-200 focus:border-indigo-500/50"
              )}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
          </div>

          {/* Toggle Advanced */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all duration-200 text-sm font-semibold",
              isExpanded 
                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                : "bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Advanced
          </button>
        </div>

        {/* Advanced Filters Panel */}
        <div className={cn(
          "grid gap-6 overflow-hidden transition-all duration-300",
          isExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        )}>
          <div className="h-px bg-zinc-800/50" />
          
          <div className="grid gap-8 md:grid-cols-2">
            {/* Budget Range */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Budget Range (USDC)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={minBudget || ""}
                  onChange={(e) => setMinBudget(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Min"
                  className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-2 px-4 text-sm text-zinc-200 outline-none focus:border-indigo-500/50"
                />
                <span className="text-zinc-700">—</span>
                <input
                  type="number"
                  value={maxBudget || ""}
                  onChange={(e) => setMaxBudget(e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="Max"
                  className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl py-2 px-4 text-sm text-zinc-200 outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Sorting */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Sort By
              </label>
              <div className="flex flex-wrap gap-2">
                {SORT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setSortBy(opt.id)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold transition-all duration-150",
                        sortBy === opt.id
                          ? "bg-indigo-600 border-indigo-500 text-white shadow-[0_0_12px_-2px_rgba(99,102,241,0.5)]"
                          : "bg-zinc-950/30 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-3">
             <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                <Filter className="h-3 w-3" />
                Category Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(tag)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-[11px] font-semibold capitalize transition-all duration-150",
                      activeTag === tag
                        ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                        : "bg-zinc-950/30 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                    )}
                  >
                    {tag === "all" ? "All categories" : tag}
                  </button>
                ))}
              </div>
          </div>
        </div>
      </div>
    </section>
  );
}
