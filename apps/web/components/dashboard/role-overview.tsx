"use client";

import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, Gavel, ShieldCheck, Star } from "lucide-react";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLE_COPY = {
  "logged-out": {
    pill: "Visitor mode",
    title: "Explore the marketplace before you commit to a role.",
    body:
      "Preview public job discovery, trust signals, and dispute explainability from the same shell the product uses after sign-in.",
    cta: { label: "Browse live jobs", href: "/jobs" },
  },
  client: {
    pill: "Client mode",
    title: "Run hiring, escrow, and milestone approvals from one surface.",
    body:
      "The client cockpit keeps brief intake, active registries, and payout confidence checks within a single operational flow.",
    cta: { label: "Launch a new brief", href: "/jobs/new" },
  },
  freelancer: {
    pill: "Freelancer mode",
    title: "Scan better work and keep proof-of-work close to payouts.",
    body:
      "The freelancer workspace prioritizes opportunity discovery, active contracts, and legible dispute evidence without sacrificing speed.",
    cta: { label: "Open the job registry", href: "/jobs" },
  },
} as const;

const HIGHLIGHTS = [
  {
    title: "Trustless Profiles",
    description:
      "Blend editable bios with Soroban reputation math so serious freelancers can market verified credibility everywhere.",
    href: "/profile/GD...CLIENT",
    icon: Star,
  },
  {
    title: "Live Job Workspaces",
    description:
      "Keep both sides aligned around milestones, evidence, escrow state, and payout actions in one shared dashboard.",
    href: "/jobs",
    icon: BriefcaseBusiness,
  },
  {
    title: "Neutral Dispute Center",
    description:
      "Explain evidence, AI reasoning, and payout splits with courtroom-level clarity once cooperation breaks down.",
    href: "/disputes/1",
    icon: Gavel,
  },
];

export function RoleOverview() {
  const role = useAuthStore((state) => state.role);
  const copy = ROLE_COPY[role];

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid gap-8 lg:grid-cols-[1.35fr_0.9fr]">
        <Card className="relative overflow-hidden border-zinc-800 bg-zinc-900/40 backdrop-blur-xl shadow-2xl rounded-[32px] p-4">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
          <CardHeader className="gap-6 p-8">
            <Badge variant="secondary" className="w-fit rounded-lg bg-zinc-800 text-zinc-400 border-zinc-700 font-bold uppercase tracking-widest text-[10px] px-3 py-1">
              {copy.pill}
            </Badge>
            <CardTitle className="max-w-3xl text-4xl sm:text-5xl font-black text-white leading-tight tracking-tighter">
              {copy.title}
            </CardTitle>
            <CardDescription className="max-w-2xl text-lg leading-relaxed text-zinc-400 font-medium">
              {copy.body}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row p-8 pt-0">
            <Link
              href={copy.cta.href}
              className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-white px-8 text-sm font-black text-zinc-950 transition-all hover:bg-zinc-200 active:scale-[0.98] shadow-xl shadow-white/5"
            >
              {copy.cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/disputes/1"
              className="inline-flex h-14 items-center justify-center rounded-2xl border border-zinc-800 px-8 text-sm font-black text-white transition-all hover:bg-zinc-900 active:scale-[0.98]"
            >
              Review Dispute Flow
            </Link>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-zinc-800 bg-zinc-950 shadow-2xl rounded-[32px] p-4">
          <CardHeader className="p-8">
            <Badge className="w-fit rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400 font-black uppercase tracking-widest text-[10px] px-3 py-1">
              Live Posture
            </Badge>
            <div className="mt-8">
              <span className="text-7xl font-black text-white tracking-tighter">4</span>
              <span className="ml-4 text-sm font-bold text-zinc-600 uppercase tracking-widest">Surfaces Aligned</span>
            </div>
            <CardDescription className="mt-6 text-zinc-400 font-medium leading-relaxed">
              Profiles, marketplace, job overview, and dispute resolution are currently synced with the Stellar Mainnet state.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 pt-0">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                <p className="text-sm font-black text-white uppercase tracking-widest">Escrow Logic Active</p>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-zinc-500 font-medium">
                Fund milestones, upload proof, approve releases, or escalate into a locked dispute flow with immutable receipts.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-6 lg:grid-cols-3">
        {HIGHLIGHTS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href} className="group">
              <Card className="h-full border-zinc-800 bg-zinc-900/40 backdrop-blur-xl transition-all duration-300 group-hover:-translate-y-2 group-hover:border-zinc-600 rounded-[24px]">
                <CardContent className="p-8">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800 text-white border border-zinc-700 transition-colors group-hover:bg-zinc-700">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-8 text-xl font-black text-white tracking-tight">{item.title}</h3>
                  <p className="mt-4 text-sm leading-relaxed text-zinc-500 font-medium">{item.description}</p>
                  <div className="mt-8 flex items-center gap-2 text-xs font-black text-zinc-400 group-hover:text-white transition-colors uppercase tracking-widest">
                    Enter Surface
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
