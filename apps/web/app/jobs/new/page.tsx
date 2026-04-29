"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Wallet } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import RichTextEditor from "@/components/ui/rich-text-editor";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { usePostJob } from "@/hooks/use-post-job";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";
import { z } from "zod";

function buildDefaultCompletionDate() {
  const target = new Date();
  target.setDate(target.getDate() + 14);
  return target.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);

const jobFormSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters."),
  description: z.string().min(20, "Scope must be at least 20 characters."),
  budget: z.number().min(100, "Budget must be at least 100 USDC."),
  milestones: z.number().min(1, "At least one milestone is required."),
  tags: z.array(z.string().min(1)).min(1, "Add at least one tag."),
  skills: z.array(z.string().min(1)).min(1, "Add at least one required skill."),
  estimatedCompletionDate: z.string().refine(
    (value) => new Date(value) >= new Date(today),
    { message: "Estimated completion date cannot be in the past." },
  ),
  estimatedDurationDays: z.number().min(1).optional(),
  memo: z.string().max(100).optional(),
});

function parseDelimitedList(value: string): string[] {
  return value
    .split(/[;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function NewJobPage() {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState(1000);
  const [milestones, setMilestones] = useState(1);
  const [memo, setMemo] = useState("");
  const [estimatedCompletionDate, setEstimatedCompletionDate] = useState(
    buildDefaultCompletionDate(),
  );
  const [estimatedDurationDays, setEstimatedDurationDays] = useState("14");
  const [tagsInput, setTagsInput] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState("GD...CLIENT");

  const { submit, isSubmitting } = usePostJob();
  const txStep = useTxStatusStore((state: { step: string }) => state.step);
  const isTxInProgress = !["idle", "confirmed", "failed"].includes(txStep);

  const tags = useMemo(() => parseDelimitedList(tagsInput), [tagsInput]);
  const skills = useMemo(() => parseDelimitedList(skillsInput), [skillsInput]);

  const reviewBody = useMemo(
    () => [
      { label: "Title", value: title || "Untitled job" },
      { label: "Budget", value: `${budget} USDC` },
      { label: "Milestones", value: `${milestones}` },
      {
        label: "Target completion",
        value: estimatedCompletionDate,
      },
      {
        label: "Duration target",
        value: estimatedDurationDays ? `${estimatedDurationDays} days` : "Not specified",
      },
      {
        label: "Tags",
        value: tags.length ? tags.join(", ") : "None",
      },
      {
        label: "Skills",
        value: skills.length ? skills.join(", ") : "None",
      },
    ],
    [title, budget, milestones, estimatedCompletionDate, estimatedDurationDays, tags, skills],
  );

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

  function validateStep(stepToValidate: number) {
    if (stepToValidate === 1) {
      const result = z
        .object({
          title: jobFormSchema.shape.title,
          description: jobFormSchema.shape.description,
          tags: jobFormSchema.shape.tags,
          skills: jobFormSchema.shape.skills,
        })
        .safeParse({
          title,
          description,
          tags,
          skills,
        });

      if (!result.success) {
        setStepError(result.error.issues[0].message);
        return false;
      }

      setStepError(null);
      return true;
    }

    if (stepToValidate === 2) {
      const result = z
        .object({
          budget: jobFormSchema.shape.budget,
          milestones: jobFormSchema.shape.milestones,
          estimatedCompletionDate: jobFormSchema.shape.estimatedCompletionDate,
          estimatedDurationDays: jobFormSchema.shape.estimatedDurationDays,
          memo: jobFormSchema.shape.memo,
        })
        .safeParse({
          budget,
          milestones,
          estimatedCompletionDate,
          estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
          memo: memo || undefined,
        });

      if (!result.success) {
        setStepError(result.error.issues[0].message);
        return false;
      }

      setStepError(null);
      return true;
    }

    const result = jobFormSchema.safeParse({
      title,
      description,
      budget,
      milestones,
      tags,
      skills,
      estimatedCompletionDate,
      estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
      memo: memo || undefined,
    });

    if (!result.success) {
      setStepError(result.error.issues[0].message);
      return false;
    }

    setStepError(null);
    return true;
  }

  function handleNext() {
    if (validateStep(step)) {
      setStep((current) => Math.min(3, current + 1));
      setStepError(null);
    }
  }

  function handleBack() {
    setStep((current) => Math.max(1, current - 1));
    setStepError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!validateStep(3)) {
      return;
    }

    try {
      await ensureWallet();
      await submit({
        title,
        description,
        budgetUsdc: budget * 10_000_000,
        milestones,
        memo: memo || undefined,
        estimatedCompletionDate,
        tags,
        skillsRequired: skills,
        estimatedDurationDays: estimatedDurationDays ? Number(estimatedDurationDays) : undefined,
      });
    } catch {
      // Error handling is managed by usePostJob + toast system
    }
  }

  return (
    <SiteShell
      eyebrow="Client Intake"
      title="Post a new job with enough clarity that the right freelancer self-selects quickly."
      description="This intake captures structured job metadata, pins it to IPFS, and publishes a job record on-chain."
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <form
          onSubmit={handleSubmit}
          className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Step {step} of 3
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                Create an IPFS-backed job brief.
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Use clear scope, budget, and milestone guidance so freelancers can respond with confidence.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold">Current stage:</span>{" "}
              {step === 1 ? "Scope" : step === 2 ? "Budget" : "Review"}
            </div>
          </div>

          <div className="mt-6 grid gap-6">
            {step === 1 ? (
              <section className="space-y-6">
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
                    disabled={isSubmitting || isTxInProgress}
                    id="job-title"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Scope
                  </label>
                  <RichTextEditor id="job-description" value={description} onChange={setDescription} />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Tags
                    </label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                      placeholder="e.g. soroban, smart-contracts, defi"
                      disabled={isSubmitting || isTxInProgress}
                      id="job-tags"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Enter comma-separated tags to make the job easier to discover.
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Required skills
                    </label>
                    <input
                      type="text"
                      value={skillsInput}
                      onChange={(event) => setSkillsInput(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                      placeholder="e.g. Rust, TypeScript, UX"
                      disabled={isSubmitting || isTxInProgress}
                      id="job-skills"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      List the core skills you expect from the freelancer.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section className="space-y-6">
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
                      min={100}
                      disabled={isSubmitting || isTxInProgress}
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
                      min={1}
                      disabled={isSubmitting || isTxInProgress}
                      id="job-milestones"
                    />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Estimated completion date
                    </label>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                      <input
                        type="date"
                        value={estimatedCompletionDate}
                        onChange={(event) => setEstimatedCompletionDate(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-slate-950 outline-none transition focus:border-amber-400"
                        min={today}
                        disabled={isSubmitting || isTxInProgress}
                        id="job-estimated-completion-date"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Target duration (days)
                    </label>
                    <input
                      type="number"
                      value={estimatedDurationDays}
                      onChange={(event) => setEstimatedDurationDays(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                      min={1}
                      disabled={isSubmitting || isTxInProgress}
                      id="job-estimated-duration"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      A target duration helps freelancers align estimates with your timeline.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Internal memo (optional)
                  </label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                    placeholder="Add a short note for internal context"
                    maxLength={100}
                    disabled={isSubmitting || isTxInProgress}
                    id="job-memo"
                  />
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section className="space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Review job metadata</p>
                      <p className="text-sm text-slate-500">
                        This structured metadata will be pinned to IPFS and referenced by the on-chain job record.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-600">
                      IPFS ready
                    </span>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {reviewBody.map((item) => (
                      <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                        <p className="mt-2 text-sm text-slate-700">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <TransactionTracker />
              </section>
            ) : null}

            {stepError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {stepError}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={handleBack}
                disabled={step === 1 || isSubmitting || isTxInProgress}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Back
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={isSubmitting || isTxInProgress}
                  className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting || isTxInProgress}
                  className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmitting || isTxInProgress
                    ? txStep === "signing"
                      ? "Waiting for signature..."
                      : "Posting on-chain..."
                    : "Post Job On-Chain"}
                </button>
              )}
            </div>
          </div>
        </form>

        <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-slate-50 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.75)] sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
            <Wallet size={16} className="text-amber-300" />
            <span>Client wallet: {walletAddress}</span>
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            IPFS-backed job publishing
          </h2>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-slate-300">
            <li>
              Job metadata is pinned to IPFS before the job is posted to the Soroban job registry.
            </li>
            <li>
              The transaction lifecycle is: Build → Simulate → Sign → Submit → Confirm.
            </li>
            <li>
              If the metadata upload fails, the on-chain post_job step is blocked to avoid stale references.
            </li>
            <li>
              On confirmation, your dashboard will show the new job and the associated IPFS metadata hash.
            </li>
            <li>
              Use tags and skills so the right freelancers can self-select quickly.
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
