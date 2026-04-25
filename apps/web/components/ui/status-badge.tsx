import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variants: Record<string, string> = {
    open: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    awaiting_funding: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    funded: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
    deliverable_submitted: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    completed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    disputed: "bg-rose-500/10 text-rose-500 border-rose-500/20",
  };

  const variant = variants[status] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors",
        variant,
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
