import Link from "next/link";
import { BriefcaseBusiness, Gavel, ShieldCheck, UserRound } from "lucide-react";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/jobs", label: "Job Board", icon: BriefcaseBusiness },
  { href: "/jobs/new", label: "Post Job", icon: ShieldCheck },
  { href: "/profile/GD...CLIENT", label: "Profiles", icon: UserRound },
  { href: "/jobs", label: "Disputes", icon: Gavel },
];

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_28%),linear-gradient(180deg,_#f7f1e7_0%,_#fffdf9_45%,_#f8fafc_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-[2rem] border border-slate-200/70 bg-white/75 px-5 py-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-[0.24em] text-slate-500 uppercase">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-xs text-white">
                  LN
                </span>
                Lance Network
              </Link>
            </div>
            <nav className="grid gap-2 sm:grid-cols-2 lg:flex">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        <section className="mb-10">
          {eyebrow ? (
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
              {description}
            </p>
          ) : null}
        </section>

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
