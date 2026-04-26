"use client";

import React from "react";
import { z } from "zod";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { JobSort } from "@/hooks/job-queries";

/**
 * Zod schema for filtering and sorting inputs.
 */
export const FilterSchema = z.object({
  query: z.string().max(100).nullish().transform((val) => val ?? ""),
  sortBy: z.enum(["newest", "oldest", "budget-high", "budget-low"]).default("newest"),
  activeTag: z.string().default("all"),
  category: z.string().default("all"),
  minBudget: z.number().optional(),
  escrowStatus: z.enum(["all", "FUNDED", "UNFUNDED", "RELEASED"]).default("all"),
});

export type FilterValues = z.infer<typeof FilterSchema>;

interface JobFiltersProps {
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  tags: string[];
  categories: string[];
}

export const JobFilters: React.FC<JobFiltersProps> = ({ values, onChange, tags, categories }) => {
  return (
    <div className="flex flex-col gap-6 p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-md">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
        <input
          type="text"
          placeholder="Search jobs..."
          value={values.query || ""}
          onChange={(e) => onChange({ ...values, query: e.target.value })}
          className="w-full pl-10 pr-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-zinc-700 transition-all"
        />
        {values.query && (
          <button 
            onClick={() => onChange({ ...values, query: "" })}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-zinc-800 text-zinc-500"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Category</h4>
        <select
          value={values.category}
          onChange={(e) => onChange({ ...values, category: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 outline-none focus:ring-1 focus:ring-zinc-700"
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Min Budget (USDC)</h4>
        <input
          type="number"
          placeholder="0"
          value={values.minBudget || ""}
          onChange={(e) => onChange({ ...values, minBudget: e.target.value ? Number(e.target.value) : undefined })}
          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-700"
        />
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Escrow Status</h4>
        <div className="flex flex-wrap gap-2">
          {["all", "FUNDED", "UNFUNDED"].map((status) => (
            <button
              key={status}
              onClick={() => onChange({ ...values, escrowStatus: status as "all" | "FUNDED" | "UNFUNDED" | "RELEASED" })}
              className={`px-3 py-1.5 rounded-md text-[10px] font-bold border transition-all ${
                values.escrowStatus === status
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
          <SlidersHorizontal className="h-3 w-3" />
          Sort By
        </h4>
        <div className="flex flex-col gap-2">
          {(["newest", "oldest", "budget-high", "budget-low"] as JobSort[]).map((option) => (
            <button
              key={option}
              onClick={() => onChange({ ...values, sortBy: option })}
              className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-all duration-150 ${
                values.sortBy === option
                  ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                  : "bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              {option.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Tags</h4>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => onChange({ ...values, activeTag: tag })}
              className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all ${
                values.activeTag === tag
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
