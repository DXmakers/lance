"use client";

import { useState } from "react";
import { 
  CalendarDays, 
  Wallet, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle2, 
  Info,
  DollarSign,
  Layers,
  FileText,
  Clock
} from "lucide-react";
import Link from "next/link";
import RichTextEditor from "@/components/ui/rich-text-editor";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { usePostJob } from "@/hooks/use-post-job";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";
import { cn } from "@/lib/utils";
import { formatUsdc } from "@/lib/format";

type Step = 1 | 2 | 3;

function buildDefaultCompletionDate() {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  return target.toISOString().slice(0, 10);
}

export default function NewJobPage() {
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [memo, setMemo] = useState("");
  const [estimatedCompletionDate, setEstimatedCompletionDate] = useState(
    buildDefaultCompletionDate(),
  );
  const [walletAddress, setWalletAddress] = useState("GD...CLIENT");

  const { submit, isSubmitting } = usePostJob();
  const txStep = useTxStatusStore((state: { step: string }) => state.step);
  const today = new Date().toISOString().slice(0, 10);

  const isTxInProgress = !["idle", "confirmed", "failed"].includes(txStep);

  async function ensureWallet() {
    const connected = await getConnectedWalletAddress();
    if (connected) {
      setWalletAddress(connected);
      return connected;
    }

    const address = await connectWallet();
    setWalletAddress(address);
    return address;
  }

  async function handleSubmit() {
    try {
      await ensureWallet();
      await submit({
        title,
        description,
        budgetUsdc: budget * 10_000_000,
        milestones,
        memo: memo || undefined,
        estimatedCompletionDate,
      });
    } catch {
      // Error handling is managed by usePostJob + toast system
    }
  }

  const nextStep = () => setStep((s) => (s + 1) as Step);
  const prevStep = () => setStep((s) => (s - 1) as Step);

  const canGoNext = () => {
    if (step === 1) return title.length >= 5 && description.length >= 20;
    if (step === 2) return budget >= 100 && milestones >= 1 && estimatedCompletionDate >= today;
    return true;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30">
      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-indigo-400">
              <div className="h-1 w-1 rounded-full bg-indigo-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Client Intake</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Create a Job Brief
            </h1>
            <p className="max-w-2xl text-sm text-zinc-500">
              Precision matters. High-quality briefs attract high-quality talent. 
              Define your scope and budget with professional clarity.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Link 
              href="/jobs"
              className="group flex items-center gap-2 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <ChevronLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
              Back to Marketplace
            </Link>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Main Content Area */}
          <main className="flex flex-col gap-6">
            {/* Step Indicator */}
            <div className="flex items-center gap-1 rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-1 backdrop-blur-md">
              <StepPill num={1} label="Basics" active={step === 1} completed={step > 1} />
              <div className="h-px w-4 bg-zinc-800" />
              <StepPill num={2} label="Budget & Timeline" active={step === 2} completed={step > 2} />
              <div className="h-px w-4 bg-zinc-800" />
              <StepPill num={3} label="Review" active={step === 3} completed={false} />
            </div>

            {/* Form Section */}
            <div className="min-h-[480px] rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-8 backdrop-blur-md transition-all duration-150">
              {step === 1 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-1.5">
                    <h2 className="text-lg font-semibold text-white">The Basics</h2>
                    <p className="text-xs text-zinc-500">What do you need built? Start with a clear title and detailed scope.</p>
                  </div>
                  
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Job Title</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Build a Soroban Liquidity Pool Monitor"
                        className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Project Scope</label>
                      <div className="min-h-[200px]">
                        <RichTextEditor id="job-description" value={description} onChange={setDescription} />
                      </div>
                      <p className="text-[10px] text-zinc-600 italic">Pro Tip: Include technical requirements and expected outcomes.</p>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-1.5">
                    <h2 className="text-lg font-semibold text-white">Budget & Logistics</h2>
                    <p className="text-xs text-zinc-500">Define the financial and temporal boundaries of your project.</p>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Budget (USDC)</label>
                      <div className="relative">
                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                        <input
                          type="number"
                          value={budget}
                          onChange={(e) => setBudget(Number(e.target.value))}
                          className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 py-3 pl-10 pr-4 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                          min={100}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Milestones</label>
                      <div className="relative">
                        <Layers className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                        <input
                          type="number"
                          value={milestones}
                          onChange={(e) => setMilestones(Number(e.target.value))}
                          className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 py-3 pl-10 pr-4 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                          min={1}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Estimated Completion</label>
                    <div className="relative max-w-xs">
                      <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                      <input
                        type="date"
                        value={estimatedCompletionDate}
                        onChange={(e) => setEstimatedCompletionDate(e.target.value)}
                        className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 py-3 pl-10 pr-4 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                        min={today}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Internal Memo (Optional)</label>
                    <input
                      type="text"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="Add a reference or internal note"
                      className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="space-y-1.5">
                    <h2 className="text-lg font-semibold text-white">Review & Publish</h2>
                    <p className="text-xs text-zinc-500">Double check everything before broadcasting to the Soroban network.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <ReviewField label="Title" value={title} icon={<FileText size={14} />} />
                    <ReviewField label="Budget" value={formatUsdc(budget * 10_000_000)} icon={<DollarSign size={14} />} accent />
                    <ReviewField label="Milestones" value={`${milestones} ${milestones === 1 ? 'Step' : 'Steps'}`} icon={<Layers size={14} />} />
                    <ReviewField label="Deadline" value={estimatedCompletionDate} icon={<Clock size={14} />} />
                  </div>

                  <div className="rounded-[12px] border border-zinc-800/50 bg-zinc-950/30 p-4">
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">Description Preview</label>
                    <div 
                      className="prose prose-invert prose-xs line-clamp-4 text-zinc-400"
                      dangerouslySetInnerHTML={{ __html: description }}
                    />
                  </div>

                  <TransactionTracker />
                </div>
              )}
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between">
              {step > 1 ? (
                <button
                  onClick={prevStep}
                  disabled={isSubmitting || isTxInProgress}
                  className="flex items-center gap-2 rounded-[12px] border border-zinc-800 bg-zinc-900/40 px-6 py-3 text-sm font-bold text-zinc-400 transition-all duration-150 hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
              ) : <div />}

              {step < 3 ? (
                <button
                  onClick={nextStep}
                  disabled={!canGoNext()}
                  className="flex items-center gap-2 rounded-[12px] bg-indigo-600 px-8 py-3 text-sm font-bold text-white transition-all duration-150 hover:bg-indigo-500 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] disabled:opacity-50 disabled:grayscale active:scale-[0.98]"
                >
                  Next Step
                  <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || isTxInProgress}
                  className="flex items-center gap-2 rounded-[12px] bg-emerald-600 px-8 py-3 text-sm font-bold text-white transition-all duration-150 hover:bg-emerald-500 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:grayscale active:scale-[0.98]"
                >
                  {isSubmitting || isTxInProgress ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      Post Job On-Chain
                      <CheckCircle2 size={16} />
                    </>
                  )}
                </button>
              )}
            </div>
          </main>

          {/* Sidebar Area */}
          <aside className="flex flex-col gap-6">
            {/* Wallet Card */}
            <div className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-md">
              <div className="flex items-center gap-3 text-zinc-400">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 border border-zinc-700/50">
                  <Wallet size={16} className="text-indigo-400" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Connected Wallet</span>
                  <span className="font-mono text-xs text-zinc-200">{walletAddress}</span>
                </div>
              </div>
            </div>

            {/* Info Card */}
            <div className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-md">
              <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-100">
                <Info size={14} className="text-indigo-400" />
                On-Chain Lifecycle
              </h3>
              <div className="space-y-4">
                <LifecycleItem step={1} label="Build" desc="Construct transaction XDR" />
                <LifecycleItem step={2} label="Simulate" desc="Estimate fees & resources" />
                <LifecycleItem step={3} label="Sign" desc="Approve via Freighter/Albedo" />
                <LifecycleItem step={4} label="Submit" desc="Broadcast to Soroban RPC" />
                <LifecycleItem step={5} label="Confirm" desc="Verify on-chain finality" />
              </div>
            </div>

            {/* Guidelines Card */}
            <div className="rounded-[12px] border border-emerald-500/10 bg-emerald-500/5 p-6 backdrop-blur-md">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-400">Trust System</h3>
              <p className="text-[11px] leading-relaxed text-emerald-400/70">
                Jobs posted here use an escrow-based contract. Budget is committed at the start and released only when milestones are approved.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StepPill({ num, label, active, completed }: { num: number; label: string; active: boolean; completed: boolean }) {
  return (
    <div className={cn(
      "flex flex-1 items-center gap-2 rounded-[8px] px-3 py-2 transition-all duration-150",
      active ? "bg-indigo-600/10 text-indigo-400" : "text-zinc-500"
    )}>
      <div className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-150",
        active ? "bg-indigo-500 text-white" : completed ? "bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-500"
      )}>
        {completed ? <CheckCircle2 size={12} /> : num}
      </div>
      <span className="text-[11px] font-bold whitespace-nowrap">{label}</span>
    </div>
  );
}

function ReviewField({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-[12px] border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-1 flex items-center gap-2 text-zinc-500">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className={cn("text-sm font-semibold", accent ? "text-emerald-400" : "text-zinc-100")}>
        {value}
      </div>
    </div>
  );
}

function LifecycleItem({ step, label, desc }: { step: number; label: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-500">
        {step}
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-bold text-zinc-300">{label}</span>
        <span className="text-[10px] text-zinc-500">{desc}</span>
      </div>
    </div>
  );
}
