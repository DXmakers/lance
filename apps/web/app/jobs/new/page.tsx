"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { api } from "@/lib/api";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [walletAddress, setWalletAddress] = useState("GD...CLIENT");
  const [loading, setLoading] = useState(false);

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
    setLoading(true);

    try {
      const clientAddress = await ensureWallet().catch(() => walletAddress);
      const job = await api.jobs.create({
        title,
        description,
        budget_usdc: budget * 10_000_000,
        milestones,
        client_address: clientAddress,
      });
      router.push(`/jobs/${job.id}`);
    } catch {
      alert("Failed to create job");
    } finally {
      setLoading(false);
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
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              id="submit-job"
            >
              {loading ? "Posting..." : "Post Job"}
            </button>
          </div>
        </form>

        <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-slate-50 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.75)] sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
            <Wallet className="h-4 w-4 text-amber-300" />
            Client wallet: {walletAddress}
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            Better briefs produce smoother milestone releases.
          </h2>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-300">
            <li>Explain what success looks like so the freelancer can submit evidence decisively.</li>
            <li>Split the budget into meaningful milestones to keep approval moments clean.</li>
            <li>Assume the dispute center may need to read this brief later and write accordingly.</li>
          </ul>
        </aside>
      </div>
    </SiteShell>
  );
}
