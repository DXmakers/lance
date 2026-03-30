import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Gavel, ShieldCheck, Star } from "lucide-react";
import { SiteShell } from "@/components/site-shell";

const highlights = [
  {
    title: "Trustless Profiles",
    description:
      "Blend editable bios and portfolio links with Soroban reputation math so serious freelancers can market verified credibility everywhere.",
    href: "/profile/GD...CLIENT",
    icon: Star,
  },
  {
    title: "Live Job Workspaces",
    description:
      "Keep both sides aligned around milestones, evidence, escrow state, and payout actions inside a single shared dashboard.",
    href: "/jobs",
    icon: BriefcaseBusiness,
  },
  {
    title: "Neutral Dispute Center",
    description:
      "Explain evidence, AI reasoning, and final payout splits with courtroom-level clarity once cooperation breaks down.",
    href: "/jobs",
    icon: Gavel,
  },
];

export default function Home() {
  return (
    <SiteShell
      eyebrow="Stellar Freelance Infrastructure"
      title="Premium freelance execution with escrow, verifiable reputation, and transparent AI arbitration."
      description="Lance is the surface layer for serious clients and elite independents who want payment security, immutable trust signals, and fast dispute resolution without losing clarity."
    >
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-8 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.55)] sm:p-10">
          <div className="flex flex-col gap-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-amber-800">
              Trust by design
            </div>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Every page is built to make strong operators look stronger.
            </h2>
            <p className="max-w-2xl text-base leading-7 text-slate-600">
              Public profiles become acquisition funnels, active jobs become
              command centers, and disputes become legible instead of chaotic.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/jobs"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Explore Job Board
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/jobs/new"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
              >
                Post a Job
              </Link>
            </div>
          </div>
        </section>

        <aside className="rounded-[2rem] border border-slate-200/80 bg-slate-950 p-8 text-slate-50 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.8)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">
            Release posture
          </p>
          <div className="mt-6 space-y-5">
            <div>
              <p className="text-4xl font-semibold">4</p>
              <p className="mt-1 text-sm text-slate-300">
                Core surfaces now aligned: profiles, marketplace, job overview,
                and dispute resolution.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-amber-300" />
                <p className="text-sm font-medium">Escrow-first workflow</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Fund milestones, upload proof, approve releases, or escalate
                into a locked dispute flow with on-chain receipts.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-10 grid gap-5 lg:grid-cols-3">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.title}
              href={item.href}
              className="group rounded-[1.75rem] border border-slate-200 bg-white/80 p-6 transition hover:-translate-y-1 hover:border-amber-300 hover:shadow-[0_25px_60px_-40px_rgba(15,23,42,0.45)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {item.description}
              </p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-950">
                Open surface
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </section>
    </SiteShell>
  );
}
