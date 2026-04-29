"use client";

import { SiteShell } from "@/components/site-shell";
import { PostJobForm } from "@/components/jobs/post-job/post-job-form";
import { Wallet } from "lucide-react";
import { useState } from "react";

export default function NewJobPage() {
  const [walletAddress] = useState("GD...CLIENT");

  return (
    <SiteShell
      eyebrow="Client Intake"
      title="Post a new job with enough clarity that the right freelancer self-selects quickly."
      description="This intake captures structured job metadata, pins it to IPFS, and publishes a job record on-chain."
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur transition-all duration-150 sm:p-8">
          <PostJobForm
            onSuccess={() => {
              // Navigation handled within usePostJob hook
            }}
          />
        </div>

        <aside className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-6 text-zinc-100 backdrop-blur sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/70 px-4 py-2 text-sm">
            <Wallet size={16} className="text-amber-400" />
            <span>Client wallet: {walletAddress}</span>
          </div>

          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-50">
            IPFS-backed job publishing
          </h2>

          <ul className="mt-6 space-y-4 text-sm leading-6 text-zinc-400">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>
              Job metadata is pinned to IPFS before posting to the Soroban job registry.
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>
              Transaction lifecycle: Build → Simulate → Sign → Submit → Confirm.
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>
              On confirmation, your dashboard shows the new job and IPFS metadata hash.
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>
              Use tags and skills so the right freelancers can self-select quickly.
            </li>
          </ul>

          <div className="mt-8 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400">
              Transaction Lifecycle
            </h3>
            <ol className="space-y-2.5 text-sm text-zinc-300">
              <li className="flex items-start gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 text-xs font-medium mt-0.5">1</span>
                <span><strong className="text-zinc-200">Build</strong> – Construct XDR with contract arguments</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 text-xs font-medium mt-0.5">2</span>
                <span><strong className="text-zinc-200">Simulate</strong> – Estimate fees and validate success</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 text-xs font-medium mt-0.5">3</span>
                <span><strong className="text-zinc-200">Sign</strong> – Approve via your connected wallet</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 text-xs font-medium mt-0.5">4</span>
                <span><strong className="text-zinc-200">Submit</strong> – Broadcast to Soroban RPC</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-medium mt-0.5">5</span>
                <span><strong className="text-zinc-200">Confirm</strong> – Verify on-chain finality</span>
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}
