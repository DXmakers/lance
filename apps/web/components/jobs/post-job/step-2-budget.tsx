"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { FormField } from "./form-field";
import { cn } from "@/lib/utils";

export interface Step2BudgetProps {
  budget: number;
  setBudget: (value: number) => void;
  milestones: number;
  setMilestones: (value: number) => void;
  estimatedCompletionDate: string;
  setEstimatedCompletionDate: (value: string) => void;
  estimatedDurationDays: string;
  setEstimatedDurationDays: (value: string) => void;
  memo: string;
  setMemo: (value: string) => void;
  budgetError?: string | null;
  milestonesError?: string | null;
  dateError?: string | null;
  durationError?: string | null;
  disabled?: boolean;
  minDate?: string;
}

export function Step2Budget({
  budget,
  setBudget,
  milestones,
  setMilestones,
  estimatedCompletionDate,
  setEstimatedCompletionDate,
  estimatedDurationDays,
  setEstimatedDurationDays,
  memo,
  setMemo,
  budgetError,
  milestonesError,
  dateError,
  durationError,
  disabled = false,
  minDate,
}: Step2BudgetProps) {
  const today = minDate || new Date().toISOString().split("T")[0];

  return (
    <section className="space-y-6" aria-labelledby="budget-timeline-heading">
      <h2 id="budget-timeline-heading" className="sr-only">
        Budget & Timeline
      </h2>

      <div className="grid gap-6 sm:grid-cols-2">
        <FormField
          id="job-budget"
          label="Budget (USDC)"
          error={budgetError}
          required
          hint="Minimum 100 USDC"
        >
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
              $
            </span>
            <input
              type="number"
              id="job-budget"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              min={100}
              className={cn(
                "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 pl-8 text-zinc-100 outline-none transition-all duration-150",
                "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
                budgetError
                  ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                  : "border-zinc-800",
              )}
              disabled={disabled}
              aria-required="true"
              aria-invalid={!!budgetError}
            />
          </div>
        </FormField>

        <FormField
          id="job-milestones"
          label="Number of Milestones"
          error={milestonesError}
          required
          hint="Divide work into measurable checkpoints"
        >
          <input
            type="number"
            id="job-milestones"
            value={milestones}
            onChange={(e) => setMilestones(Number(e.target.value))}
            min={1}
            className={cn(
              "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none transition-all duration-150",
              "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              milestonesError
                ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                : "border-zinc-800",
            )}
            disabled={disabled}
            aria-required="true"
            aria-invalid={!!milestonesError}
          />
        </FormField>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <FormField
          id="job-estimated-completion-date"
          label="Estimated Completion Date"
          error={dateError}
          required
          hint="When should the work be finished?"
        >
          <div className="relative">
            <CalendarDays className="absolute left-4 top-3.5 h-4 w-4 text-zinc-500" />
            <input
              type="date"
              id="job-estimated-completion-date"
              value={estimatedCompletionDate}
              onChange={(e) => setEstimatedCompletionDate(e.target.value)}
              min={today}
              className={cn(
                "flex h-11 w-full rounded-xl border bg-zinc-950/50 pl-10 pr-4 py-3 text-zinc-100 outline-none transition-all duration-150",
                "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
                "disabled:cursor-not-allowed disabled:opacity-50",
                dateError
                  ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                  : "border-zinc-800",
              )}
              disabled={disabled}
              aria-required="true"
              aria-invalid={!!dateError}
            />
          </div>
        </FormField>

        <FormField
          id="job-estimated-duration"
          label="Target Duration (Days)"
          error={durationError}
          hint="Optional: helps freelancers align with your timeline"
        >
          <input
            type="number"
            id="job-estimated-duration"
            value={estimatedDurationDays}
            onChange={(e) => setEstimatedDurationDays(e.target.value)}
            min={1}
            className={cn(
              "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 outline-none transition-all duration-150",
              "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
              durationError
                ? "border-rose-500 focus:border-rose-400 focus:ring-rose-400/20"
                : "border-zinc-800",
            )}
            disabled={disabled}
            aria-invalid={!!durationError}
          />
        </FormField>
      </div>

      <FormField
        id="job-memo"
        label="Internal Memo"
        error={null}
        hint="Optional: private notes for your reference (max 100 characters)"
      >
        <input
          type="text"
          id="job-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={100}
          className={cn(
            "flex h-11 w-full rounded-xl border bg-zinc-950/50 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 outline-none transition-all duration-150",
            "focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "border-zinc-800",
          )}
          disabled={disabled}
          placeholder="Add a short note for internal context"
        />
        {memo && (
          <p className="mt-1 text-xs text-zinc-500">
            {memo.length}/100 characters
          </p>
        )}
      </FormField>
    </section>
  );
}
