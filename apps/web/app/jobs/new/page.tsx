"use client";

import { useState } from "react";
import { Wallet, Info, Sparkles } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { useCreateJob } from "@/hooks/use-create-job";
import { DatePicker, datePickerSchema } from "@/components/ui/date-picker";
import { useWallet } from "@/hooks/use-wallet";
import { ErrorBoundary } from "@/components/error-boundary";

export default function NewJobPage() {
  const { address: walletAddress } = useWallet();
  const { mutate: createJob, isPending: loading } = useCreateJob();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [completionDate, setCompletionDate] = useState<Date | undefined>();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [memo, setMemo] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    
    // Validate date
    const validation = datePickerSchema.safeParse({ date: completionDate });
    if (!validation.success) {
      setErrors({ completionDate: validation.error.issues[0].message });
      return;
    }
    setErrors({});

    createJob({
      title,
      description,
      budget_usdc: budget * 10_000_000,
      milestones,
      client_address: walletAddress || "GD...CLIENT",
      estimated_completion_date: completionDate?.toISOString(),
    });
  }

  return (
    <SiteShell
      eyebrow="Create Opportunity"
      title="Define your project scope with high-precision milestones."
      description="Leverage decentralized talent by providing clear expectations and secure on-chain payments."
    >
      <ErrorBoundary>
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <form
            onSubmit={handleSubmit}
            className="group relative overflow-hidden rounded-[24px] border border-white/5 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-white/10"
          >
            {/* Subtle gradient overlay */}
            <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-indigo-500/5 blur-3xl transition-opacity group-hover:opacity-100" />
            
            <div className="relative grid gap-8">
              <div className="grid gap-2">
                <label htmlFor="job-title" className="text-sm font-semibold text-zinc-400">
                  Project Title
                </label>
                <input
                  id="job-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-12 w-full rounded-[12px] border border-white/10 bg-zinc-950/50 px-4 text-sm text-zinc-100 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="e.g., Soroban Smart Contract Audit"
                  required
                  disabled={loading}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="job-description" className="text-sm font-semibold text-zinc-400">
                  Scope & Requirements
                </label>
                <textarea
                  id="job-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[160px] w-full rounded-[12px] border border-white/10 bg-zinc-950/50 p-4 text-sm text-zinc-100 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="Detail the technical requirements and success criteria..."
                  required
                  disabled={loading}
                />
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="job-budget" className="text-sm font-semibold text-zinc-400">
                    Budget (USDC)
                  </label>
                  <input
                    id="job-budget"
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    className="h-12 w-full rounded-[12px] border border-white/10 bg-zinc-950/50 px-4 text-sm text-zinc-100 outline-none transition-all focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10"
                    min={100}
                    required
                    disabled={loading}
                  />
                </div>
                
                <DatePicker 
                  label="Estimated Completion"
                  date={completionDate}
                  onChange={setCompletionDate}
                  error={errors.completionDate}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="job-milestones" className="text-sm font-semibold text-zinc-400">
                  Milestone Count
                </label>
                <div className="flex items-center gap-4">
                  <input
                    id="job-milestones"
                    type="range"
                    min="1"
                    max="10"
                    value={milestones}
                    onChange={(e) => setMilestones(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-indigo-500 transition-all hover:accent-indigo-400"
                    disabled={loading}
                  />
                  <span className="flex h-10 w-12 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-indigo-400">
                    {milestones}
                  </span>
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
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative flex h-14 items-center justify-center gap-2 overflow-hidden rounded-[16px] bg-indigo-600 px-8 text-sm font-bold text-white transition-all hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-50"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                {loading ? (
                  "Deploying Strategy..."
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Post Project Opportunity
                  </>
                )}
              </button>
            </div>
          </form>

          <aside className="flex flex-col gap-6">
            <div className="rounded-[24px] border border-white/5 bg-zinc-950 p-8 shadow-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                Verified Client Wallet
              </div>
              
              <div className="mt-6 flex items-center gap-4 rounded-[16px] bg-white/5 p-4 border border-white/5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-400">
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Active Address</p>
                  <p className="truncate font-mono text-xs text-zinc-300">{walletAddress || "Not connected"}</p>
                </div>
              </div>

              <h2 className="mt-8 text-xl font-semibold text-white">
                Why clear timelines matter?
              </h2>
              <div className="mt-6 space-y-6">
                {[
                  { title: "Talent Self-Selection", desc: "Precise deadlines help experts manage their capacity and bid accurately." },
                  { title: "On-Chain Confidence", desc: "Smart contracts rely on clear milestone parameters for automated releases." },
                  { title: "Dispute Mitigation", desc: "Historical data shows 80% of disputes are avoided with clear brief discipline." }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-500">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">{item.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/5 p-6 flex gap-4">
              <Info className="h-5 w-5 text-amber-500 shrink-0" />
              <p className="text-xs leading-relaxed text-amber-200/70">
                <span className="font-bold text-amber-500">Stellar Network:</span> All milestones are settled in USDC and verified by the Soroban smart contract layer.
              </p>
            </div>
          </aside>
        </div>
      </ErrorBoundary>
    </SiteShell>
  );
}