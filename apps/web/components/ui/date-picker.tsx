"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";

export const datePickerSchema = z.object({
  date: z.date({
    message: "A completion date is required.",
  }).min(new Date(), { message: "Completion date must be in the future." }),
});

interface DatePickerProps {
  date?: Date;
  onChange: (date: Date | undefined) => void;
  error?: string;
  label?: string;
}

export function DatePicker({ date, onChange, error, label }: DatePickerProps) {
  return (
    <div className="grid gap-2">
      {label && (
        <label className="text-sm font-semibold text-zinc-400">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="date"
          value={date ? format(date, "yyyy-MM-dd") : ""}
          onChange={(e) => {
            const d = e.target.value ? new Date(e.target.value) : undefined;
            onChange(d);
          }}
          className={cn(
            "flex h-12 w-full rounded-[12px] border border-white/10 bg-zinc-950/50 px-4 py-2 text-sm text-zinc-100 shadow-inner backdrop-blur-md transition-all duration-150 outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10",
            error && "border-amber-500/50 focus:border-amber-500/50 focus:ring-amber-500/10"
          )}
        />
        <CalendarIcon className="absolute right-4 top-3.5 h-5 w-5 text-zinc-500 pointer-events-none" />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-xs font-medium text-amber-500 animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
