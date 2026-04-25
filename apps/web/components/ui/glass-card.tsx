import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function GlassCard({ children, className, ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur-md p-6 shadow-2xl transition-all duration-300 hover:bg-zinc-900/60",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
