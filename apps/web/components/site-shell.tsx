import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function SiteShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8 pb-8">
      <section className="glass-surface relative overflow-hidden rounded-[2rem] border border-border/60 px-6 py-8 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.65)] sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(226,154,47,0.16),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(13,124,102,0.14),transparent_26%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            {eyebrow ? (
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-primary/90">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/jobs"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border/70 bg-background/70 px-5 py-3 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:text-primary"
            >
              Job Registry
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/jobs/new"
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Launch Brief
            </Link>
          </div>
        </div>
      </section>

      <div className="flex-1">{children}</div>
    </div>
  );
}
