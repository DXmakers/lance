"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
}

export function FormField({
  id,
  label,
  children,
  error,
  hint,
  required = false,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-zinc-300"
      >
        {label}
        {required && <span className="ml-1 text-amber-400">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-sm text-rose-400" role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}
