"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { connectWallet, signTransaction } from "@/lib/stellar";

const DEFAULT_JOB = {
  title: "Deterministic Soroban integration audit",
  description: "Review escrow edge cases and provide a reproducible release plan.",
  budget_usdc: "425.00",
  milestones: "3",
};

export default function NewJobPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [status, setStatus] = useState("Ready to prepare a mock Soroban transaction.");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState(DEFAULT_JOB);

  const encodedBudget = useMemo(() => {
    return Math.round(Number(form.budget_usdc || 0) * 1_000_0000);
  }, [form.budget_usdc]);

  async function ensureWallet(): Promise<string> {
    if (walletAddress) {
      return walletAddress;
    }

    const address = await connectWallet();
    setWalletAddress(address);
    return address;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("Connecting wallet...");

    try {
      const address = await ensureWallet();
      setStatus("Requesting signature from wallet...");

      const signed = await signTransaction(
        JSON.stringify({
          action: "create_job",
          title: form.title,
          budget_usdc: encodedBudget,
          client_address: address,
        }),
      );
      setSignature(signed);
      setStatus("Signature captured. Writing job to mocked backend...");

      await api.jobs.create({
        title: form.title,
        description: form.description,
        budget_usdc: encodedBudget,
        milestones: Number(form.milestones),
        client_address: address,
      });

      setStatus("Job created. Redirecting to the board...");
      router.push("/jobs");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Job submission failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a,#020617_55%)] px-6 py-10 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="space-y-3">
          <Link href="/jobs" className="text-sm text-cyan-300 hover:text-cyan-200">
            Back to jobs
          </Link>
          <h1 className="text-4xl font-semibold">Post a Job</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            This flow intentionally signs a deterministic payload before persisting
            a job so Playwright can validate post-signature UI state changes.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-[1.3fr_0.7fr]">
          <form
            onSubmit={onSubmit}
            className="space-y-5 rounded-3xl border border-slate-800 bg-slate-950/70 p-6"
          >
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-200">Title</span>
              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-cyan-400"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-200">Description</span>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={5}
                className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-cyan-400"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Budget (USDC)</span>
                <input
                  inputMode="decimal"
                  value={form.budget_usdc}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      budget_usdc: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Milestones</span>
                <input
                  inputMode="numeric"
                  value={form.milestones}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      milestones: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none transition focus:border-cyan-400"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {isSubmitting ? "Submitting..." : "Sign and Create Job"}
            </button>
          </form>

          <aside className="space-y-4 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
                Wallet
              </p>
              <p className="mt-2 break-all text-sm text-slate-100">
                {walletAddress || "Not connected"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
                Signature
              </p>
              <p className="mt-2 break-all font-mono text-xs text-slate-300">
                {signature || "Pending approval"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">
                Status
              </p>
              <p className="mt-2 text-sm text-slate-200">{status}</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
