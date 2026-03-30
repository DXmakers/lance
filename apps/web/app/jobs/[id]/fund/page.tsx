"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { api, type Job } from "@/lib/api";
import { depositEscrow } from "@/lib/contracts";
import { formatUsdc } from "@/lib/format";

const PLATFORM_FEE_BPS = 200;

type FundingState =
  | "idle"
  | "confirming"
  | "signing"
  | "polling"
  | "funded"
  | "error";

export default function EscrowFundingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fundingState, setFundingState] = useState<FundingState>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.jobs.get(id).then(setJob).catch((error: Error) => setLoadError(error.message));
  }, [id]);

  const platformFee = job
    ? Math.floor((job.budget_usdc * PLATFORM_FEE_BPS) / 10_000)
    : 0;
  const total = job ? job.budget_usdc + platformFee : 0;

  const handleFund = useCallback(async () => {
    if (!job) return;

    setFundingState("signing");
    setErrorMsg(null);

    try {
      const hash = await depositEscrow({
        jobId: BigInt(job.on_chain_job_id ?? 0),
        clientAddress: job.client_address,
        freelancerAddress: job.freelancer_address ?? "",
        amountUsdc: BigInt(total),
        milestones: job.milestones,
      });
      setTxHash(hash);
      setFundingState("polling");

      await api.jobs.markFunded(id, {
        client_address: job.client_address,
      }).catch(() => null);

      let attempts = 0;
      const interval = setInterval(async () => {
        attempts += 1;
        try {
          const updated = await api.jobs.get(id);
          if (updated.status === "in_progress" || updated.status === "funded") {
            clearInterval(interval);
            setJob(updated);
            setFundingState("funded");
          }
        } catch {
          // Ignore transient polling errors.
        }
        if (attempts >= 30) {
          clearInterval(interval);
          setFundingState("funded");
        }
      }, 2000);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Unknown error");
      setFundingState("error");
    }
  }, [id, job, total]);

  if (loadError) {
    return (
      <SiteShell
        eyebrow="Escrow Review"
        title="Funding unavailable"
        description={loadError}
      >
        <div className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-700">
          Failed to load job: {loadError}
        </div>
      </SiteShell>
    );
  }

  if (!job) {
    return (
      <SiteShell
        eyebrow="Escrow Review"
        title="Loading funding breakdown"
        description="Preparing the contract summary before the wallet signature."
      >
        <div className="h-80 animate-pulse rounded-[2rem] border border-slate-200 bg-white/70" />
      </SiteShell>
    );
  }

  if (fundingState === "funded") {
    return (
      <SiteShell
        eyebrow="Escrow Review"
        title="Escrow Funded!"
        description="The job can now transition into active execution."
      >
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-emerald-200 bg-white/90 p-8 text-center shadow-[0_25px_80px_-48px_rgba(16,185,129,0.45)]">
          <h2 className="text-3xl font-semibold text-emerald-700">
            Escrow Funded!
          </h2>
          <p className="mt-4 text-slate-600">
            <strong>{formatUsdc(total)}</strong> is now locked on-chain.
          </p>
          {txHash ? (
            <p className="mt-3 break-all text-sm text-slate-500">
              Transaction: <code>{txHash}</code>
            </p>
          ) : null}
          <button
            onClick={() => router.push(`/jobs/${id}`)}
            className="mt-8 rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            Go to Job
          </button>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      eyebrow="Escrow Review"
      title="Fund Escrow"
      description="Review the full contract value, platform fee, and milestone count before authorising the blockchain transfer."
    >
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8">
          <div className="rounded-[1.6rem] border border-amber-200 bg-amber-50 p-5">
            <h2 className="text-lg font-semibold text-amber-900">
              Escrow Funding Summary
            </h2>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <div className="flex justify-between gap-4">
                <span>Job</span>
                <span className="text-right font-medium">{job.title}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Milestones</span>
                <span className="font-medium">{job.milestones}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Contract value</span>
                <span className="font-medium">{formatUsdc(job.budget_usdc)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Platform fee (2%)</span>
                <span className="font-medium">{formatUsdc(platformFee)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-amber-200 pt-3 text-base font-semibold text-slate-950">
                <span>Total to deposit</span>
                <span>{formatUsdc(total)}</span>
              </div>
            </div>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-1 h-4 w-4 accent-amber-600"
            />
            <span className="text-sm leading-6 text-slate-600">
              I have verified the wallet addresses, milestone breakdown, and total amount. I understand these funds stay locked until approvals or a dispute resolution completes.
            </span>
          </label>

          {fundingState === "error" && errorMsg ? (
            <div className="mt-4 rounded-[1.4rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          ) : null}

          <button
            onClick={() => setFundingState("confirming")}
            disabled={!checked || fundingState !== "idle"}
            className="mt-6 w-full rounded-full bg-amber-500 px-6 py-4 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-200"
          >
            Deposit {formatUsdc(total)} into Escrow
          </button>
        </section>

        <aside className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_25px_80px_-48px_rgba(15,23,42,0.75)] sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            <ShieldAlert className="h-4 w-4" />
            High-conviction action
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">
            This step flips the job into capital-backed execution.
          </h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Once funds are deposited into escrow they can only move through milestone releases or a dispute verdict. Make sure the freelancer wallet and milestone count are correct.
          </p>
        </aside>
      </div>

      {fundingState === "confirming" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-2xl font-semibold text-slate-950">
              Final Confirmation
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              You are about to transfer{" "}
              <strong>{formatUsdc(total)}</strong> into the escrow smart
              contract for <strong>{job.title}</strong>.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setFundingState("idle")}
                className="flex-1 rounded-full border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleFund}
                className="flex-1 rounded-full bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
              >
                Confirm &amp; Sign
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fundingState === "signing" || fundingState === "polling" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-sm rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-2xl">
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-amber-500" />
            <p className="mt-4 font-semibold text-slate-800">
              {fundingState === "signing"
                ? "Waiting for wallet signature..."
                : "Broadcasting transaction and confirming on-chain..."}
            </p>
            {txHash ? (
              <p className="mt-3 break-all text-xs text-slate-500">tx: {txHash}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
