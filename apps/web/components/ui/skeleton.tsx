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
    <article className="rounded-3xl border border-white/10 bg-zinc-950/70 p-6 shadow-[0_24px_64px_-44px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="h-8 w-64 max-w-[85vw]" />
        </div>
        <RepoAvatarSkeleton />
      </div>

      <div className="mt-5 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[94%]" />
        <Skeleton className="h-3 w-[68%]" />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>

      <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
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
