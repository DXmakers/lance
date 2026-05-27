"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface StepIndicatorProps {
  currentStep: number;
  steps: Array<{ label: string; description?: string }>;
  className?: string;
}

export function StepIndicator({
  currentStep,
  steps,
  className,
}: StepIndicatorProps) {
  return (
    <nav aria-label="Job creation progress" className={cn("flex items-center", className)}>
      <ol className="flex items-center space-x-4 sm:space-x-8">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <li key={stepNumber} className="flex items-center">
              <div className="flex items-center">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-150 sm:h-10 sm:w-10 sm:text-sm",
                    isCompleted
                      ? "bg-emerald-500/20 text-emerald-400"
                      : isCurrent
                      ? "bg-amber-400/20 text-amber-300"
                      : "bg-zinc-800 text-zinc-500",
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? "✓" : stepNumber}
                </span>
                <div className="ml-2 hidden sm:block">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isCurrent ? "text-amber-300" : "text-zinc-400",
                    )}
                  >
                    {step.label}
                  </p>
                  {step.description && (
                    <p className="text-xs text-zinc-500">{step.description}</p>
                  )}
                </div>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-4 h-0.5 w-8 sm:mx-8 sm:w-12",
                    isCompleted ? "bg-emerald-500/50" : "bg-zinc-800",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
