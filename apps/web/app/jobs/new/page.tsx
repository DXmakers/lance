"use client";

import { Wallet } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { PostJobForm } from "@/components/jobs/post-job-form";
import { PostJobErrorBoundary } from "@/components/jobs/post-job-error-boundary";

export default function NewJobPage() {
  return (
    <SiteShell
      eyebrow="Client Intake"
      title="Post a new job with enough clarity that the right freelancer self-selects quickly."
      description="This intake keeps the payload lightweight for the current backend while still pushing teams toward better briefs, cleaner budgets, and milestone discipline."
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <PostJobErrorBoundary>
          <PostJobForm
            onSuccess={() => {
              console.log("Job posted successfully");
            }}
            onError={(error) => {
              console.error("Job posting failed:", error);
            }}
          />
        </PostJobErrorBoundary>

        <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-slate-50 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.75)] sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
            <Wallet size={16} className="text-amber-300" />
            <span>Client wallet: Connected</span>
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            Your job goes on-chain.
          </h2>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-300">
            <li>
              The transaction follows a secure pipeline: Build → Simulate → Sign → Submit → Confirm.
            </li>
            <li>
              Simulation estimates fees and resources before you sign, so there are
              no surprises.
            </li>
            <li>
              If a sequence-number mismatch occurs, the system automatically
              retries with a fresh account state.
            </li>
            <li>
              On confirmation, the job is posted to the Soroban job registry and
              your dashboard updates instantly.
            </li>
            <li>
              Split the budget into meaningful milestones to keep approval moments
              clean.
            </li>
            <li>
              Add required skills to help freelancers find relevant opportunities.
            </li>
          </ul>

          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Transaction Lifecycle
            </h3>
            <ol className="space-y-2 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">1</span>
                Build – Construct XDR with contract arguments
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">2</span>
                Simulate – Estimate fees and validate success
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">3</span>
                Sign – Approve via your connected wallet
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">4</span>
                Submit – Broadcast to Soroban RPC
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">5</span>
                Confirm – Verify on-chain finality
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}