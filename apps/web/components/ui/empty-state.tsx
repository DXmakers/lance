"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "light" | "dark";
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  tone = "light",
}: EmptyStateProps) {
  const isDark = tone === "dark";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-3 rounded-[1.75rem] border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center",
        isDark && "border-zinc-800 bg-zinc-900/20",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500",
            isDark && "bg-zinc-800 text-zinc-300",
          )}
        >
          {icon}
        </div>
      ) : null}
      <p className={cn("text-base font-semibold text-slate-700", isDark && "text-zinc-100")}>
        {title}
      </p>
      <p
        className={cn(
          "max-w-md text-sm leading-6 text-slate-500",
          isDark && "text-zinc-400",
        )}
      >
        {description}
      </p>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
