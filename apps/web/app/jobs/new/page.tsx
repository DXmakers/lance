"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { usePostJob } from "@/hooks/use-post-job";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

export default function NewJobPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [memo, setMemo] = useState("");
  const [walletAddress, setWalletAddress] = useState("GD...CLIENT");

  const { submit, isSubmitting } = usePostJob();
  const txStep = useTxStatusStore((state: { step: string }) => state.step);

  // Determine if a transaction is in-flight (any non-idle, non-terminal step)
  const isTxInProgress = !["idle", "confirmed", "failed"].includes(txStep);

  async function ensureWallet() {
    const connected = await getConnectedWalletAddress();
    if (connected) {
      setWalletAddress(connected);
      return connected;
    }

    const newlyConnected = await connectWallet();
    setWalletAddress(newlyConnected);
    return newlyConnected;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    try {
      await ensureWallet();
      await submit({
        title,
        description,
        budgetUsdc: budget * 10_000_000,
        milestones,
        memo: memo || undefined,
      });
    } catch {
      // Error handling is managed by usePostJob + toast system
    }
  }

  return (
    <SiteShell
      eyebrow="Client Intake"
      title="Post a new job with enough clarity that the right freelancer self-selects quickly."
      description="This intake keeps the payload lightweight for the current backend while still pushing teams toward better briefs, cleaner budgets, and milestone discipline."
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <form
          onSubmit={handleSubmit}
          className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8"
        >
          <div className="grid gap-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                placeholder="Build a Soroban Smart Contract"
                required
                id="job-title"
                disabled={isSubmitting || isTxInProgress}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Scope
              </label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                placeholder="Describe requirements, acceptance criteria, and what counts as a complete milestone."
                required
                id="job-description"
                disabled={isSubmitting || isTxInProgress}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Budget (USDC)
                </label>
                <input
                  type="number"
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                  required
                  min={100}
                  id="job-budget"
                  disabled={isSubmitting || isTxInProgress}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Milestones
                </label>
                <input
                  type="number"
                  value={milestones}
                  onChange={(event) => setMilestones(Number(event.target.value))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                  min="1"
                  required
                  id="job-milestones"
                  disabled={isSubmitting || isTxInProgress}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Memo (optional)
              </label>
              <input
                type="text"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                placeholder="Add a reference or internal note for this job"
                maxLength={100}
                id="job-memo"
                disabled={isSubmitting || isTxInProgress}
              />
            </div>

            {/* Transaction Tracker */}
            <TransactionTracker />

            <button
              type="submit"
              disabled={isSubmitting || isTxInProgress}
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              id="submit-job"
            >
              {isSubmitting || isTxInProgress
                ? txStep === "signing"
                  ? "Waiting for signature..."
                  : "Posting on-chain..."
                : "Post Job On-Chain"}
            </button>
          </div>
        </form>

        <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-slate-50 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.75)] sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
            <Wallet className="h-4 w-4 text-amber-300" />
            Client wallet: {walletAddress}
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            Your job goes on-chain.
          </h2>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-300">
            <li>
              The transaction follows a secure pipeline: Build &rarr; Simulate &rarr;
              Sign &rarr; Submit &rarr; Confirm.
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
          </ul>

          {/* On-chain flow summary */}
          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Transaction Lifecycle
            </h3>
            <ol className="space-y-2 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                  1
                </span>
                Build – Construct XDR with contract arguments
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                  2
                </span>
                Simulate – Estimate fees and validate success
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                  3
                </span>
                Sign – Approve via your connected wallet
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
                  4
                </span>
                Submit – Broadcast to Soroban RPC
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
                  5
                </span>
                Confirm – Verify on-chain finality
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}
