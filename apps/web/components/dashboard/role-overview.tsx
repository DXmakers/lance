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
    <>
      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
        <Card className="border-border/70">
          <CardHeader className="gap-4">
            <Badge variant="secondary" className="w-fit rounded-full">
              {copy.pill}
            </Badge>
            <CardTitle className="max-w-2xl text-3xl sm:text-4xl">{copy.title}</CardTitle>
            <CardDescription className="max-w-2xl text-base leading-7">
              {copy.body}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={copy.cta.href}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              {copy.cta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/disputes/1"
              className="inline-flex items-center justify-center rounded-full border border-border/70 px-6 py-3 text-sm font-semibold text-foreground transition hover:border-primary/35 hover:text-primary"
            >
              Review dispute flow
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-slate-950 text-slate-50 dark:bg-card dark:text-card-foreground">
          <CardHeader>
            <Badge className="w-fit rounded-full bg-amber-500 text-slate-950 hover:bg-amber-500">
              Release posture
            </Badge>
            <CardTitle className="text-4xl">4</CardTitle>
            <CardDescription className="text-slate-300 dark:text-muted-foreground">
              Core surfaces aligned: profiles, marketplace, job overview, and dispute resolution.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 dark:border-border/50 dark:bg-background/40">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-amber-300" />
                <p className="text-sm font-medium">Escrow-first workflow</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300 dark:text-muted-foreground">
                Fund milestones, upload proof, approve releases, or escalate into a locked dispute flow with on-chain receipts.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="mt-10 grid gap-5 lg:grid-cols-3">
        {HIGHLIGHTS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href}>
              <Card className="group h-full border-border/70 transition hover:-translate-y-1 hover:border-primary/35">
                <CardContent className="p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-card-foreground">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-card-foreground">
                    Open surface
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </>
  );
}
