import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-xl border border-white/10 bg-gradient-to-r from-zinc-800/60 via-zinc-700/70 to-zinc-800/60 bg-[length:220%_100%] animate-[shimmer_1.8s_ease-in-out_infinite]",
        className,
      )}
    />
  );
}

export function RepoAvatarSkeleton({ className }: SkeletonProps) {
  return <Skeleton className={cn("h-10 w-10 rounded-full", className)} />;
}

export function JobCardSkeleton() {
  return (
    <article className="rounded-[12px] border border-white/5 bg-zinc-900/40 p-5 backdrop-blur-md">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-6 w-48 max-w-[85vw]" />
        </div>
        <Skeleton className="h-8 w-8 rounded-[8px]" />
      </div>

      <div className="mt-4 space-y-1.5">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-[94%]" />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      <div className="mt-4 grid gap-2 border-t border-white/5 pt-4 sm:grid-cols-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </article>
  );
}

export function JobDetailsSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]" role="status" aria-live="polite">
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 backdrop-blur-sm sm:p-8">
          <div className="space-y-4">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-10 w-[70%]" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[88%]" />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>
        <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 backdrop-blur-sm">
          <Skeleton className="h-6 w-48" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </section>
      </div>
      <aside className="space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 backdrop-blur-sm">
          <Skeleton className="h-6 w-32" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </section>
      </aside>
      <span className="sr-only">Loading job workspace</span>
    </div>
  );
}
