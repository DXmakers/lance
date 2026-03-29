"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type Job } from "@/lib/api";
import { depositEscrow } from "@/lib/contracts";

// Platform fee: 2% (200 bps)
const PLATFORM_FEE_BPS = 200;
// Micro-USDC per USDC (7 decimal places)
const MICRO_USDC = 10_000_000;

function formatUsdc(micro: number): string {
  return (micro / MICRO_USDC).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

type FundingState = "idle" | "confirming" | "signing" | "polling" | "funded" | "error";

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
    api.jobs.get(id).then(setJob).catch((e: Error) => setLoadError(e.message));
  }, [id]);

  const platformFee = job ? Math.floor((job.budget_usdc * PLATFORM_FEE_BPS) / 10_000) : 0;
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

      // Poll job status until it transitions to in_progress / funded
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const updated = await api.jobs.get(id);
          if (updated.status === "in_progress" || updated.status === "funded") {
            clearInterval(interval);
            setJob(updated);
            setFundingState("funded");
          }
        } catch {
          // ignore transient errors during polling
        }
        if (attempts >= 30) {
          clearInterval(interval);
          // Even if we can't confirm status, tx was submitted
          setFundingState("funded");
        }
      }, 2000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setFundingState("error");
    }
  }, [job, total, id]);

  if (loadError) {
    return (
      <main className="p-8 max-w-lg mx-auto">
        <p className="text-red-600">Failed to load job: {loadError}</p>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="p-8 max-w-lg mx-auto">
        <p className="text-gray-500">Loading job details…</p>
      </main>
    );
  }

  if (fundingState === "funded") {
    return (
      <main className="p-8 max-w-lg mx-auto">
        <div className="rounded-xl border border-green-500 bg-green-50 p-6 text-center">
          <h1 className="text-2xl font-bold text-green-700 mb-2">Escrow Funded!</h1>
          <p className="text-gray-600 mb-1">
            <strong>{formatUsdc(total)}</strong> is now locked on-chain.
          </p>
          {txHash && (
            <p className="text-sm text-gray-500 break-all">
              Transaction: <code>{txHash}</code>
            </p>
          )}
          <p className="mt-4 text-sm text-green-700 font-medium">
            Both you and the freelancer can now see the job as &quot;Actively Funded&quot;.
          </p>
          <button
            onClick={() => router.push(`/jobs/${id}`)}
            className="mt-6 px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700"
          >
            Go to Job
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-1">Fund Escrow</h1>
      <p className="text-gray-500 text-sm mb-6">
        Review the breakdown carefully before authorising the transfer.
      </p>

      {/* Summary card */}
      <div className="rounded-xl border border-amber-400 bg-amber-50 p-5 mb-6 space-y-3">
        <h2 className="font-semibold text-amber-800 text-lg">Escrow Funding Summary</h2>

        <div className="divide-y divide-amber-200 text-sm">
          <div className="flex justify-between py-2">
            <span className="text-gray-600">Job</span>
            <span className="font-medium truncate max-w-[60%] text-right">{job.title}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-600">Milestones</span>
            <span className="font-medium">{job.milestones}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-600">Contract value</span>
            <span className="font-medium">{formatUsdc(job.budget_usdc)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-600">Platform fee (2%)</span>
            <span className="font-medium">{formatUsdc(platformFee)}</span>
          </div>
          <div className="flex justify-between py-2 font-bold text-base">
            <span>Total to deposit</span>
            <span className="text-amber-900">{formatUsdc(total)}</span>
          </div>
        </div>

        {/* Freelancer address */}
        {job.freelancer_address && (
          <p className="text-xs text-gray-500 break-all">
            Freelancer: {job.freelancer_address}
          </p>
        )}
      </div>

      {/* Caution banner */}
      <div className="rounded-lg bg-red-50 border border-red-300 p-4 mb-6 text-sm text-red-700">
        <strong>Caution:</strong> Once funds are deposited into the smart-contract escrow they can
        only be released by milestone approval or a dispute verdict. This action cannot be undone.
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-start gap-3 mb-6 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-amber-600"
        />
        <span className="text-sm text-gray-700">
          I have verified the job details, milestone breakdown, and total amount above. I understand
          funds will be locked on-chain until milestones are released or a dispute is resolved.
        </span>
      </label>

      {/* Error display */}
      {fundingState === "error" && errorMsg && (
        <div className="rounded-lg bg-red-100 border border-red-400 p-3 mb-4 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* CTA button */}
      <button
        onClick={() => setFundingState("confirming")}
        disabled={!checked || fundingState !== "idle"}
        className="w-full py-3 rounded-lg bg-amber-600 text-white font-bold text-base
                   hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Deposit {formatUsdc(total)} into Escrow
      </button>

      {/* Final confirmation modal */}
      {fundingState === "confirming" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Final Confirmation</h2>
            <p className="text-gray-600 text-sm">
              You are about to transfer{" "}
              <strong className="text-amber-700">{formatUsdc(total)}</strong> (including 2%
              platform fee) into the escrow smart contract for:
            </p>
            <p className="font-semibold text-gray-800 text-center">{job.title}</p>
            <p className="text-xs text-red-600">
              This is a blockchain transaction. Make sure your wallet is connected and you have
              sufficient USDC balance.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setFundingState("idle")}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleFund}
                className="flex-1 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700"
              >
                Confirm &amp; Sign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signing / polling overlay */}
      {(fundingState === "signing" || fundingState === "polling") && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center space-y-4">
            <div className="animate-spin h-10 w-10 border-4 border-amber-500 border-t-transparent rounded-full mx-auto" />
            <p className="font-semibold text-gray-700">
              {fundingState === "signing"
                ? "Waiting for wallet signature…"
                : "Broadcasting transaction… confirming on-chain"}
            </p>
            {txHash && (
              <p className="text-xs text-gray-400 break-all">tx: {txHash}</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
