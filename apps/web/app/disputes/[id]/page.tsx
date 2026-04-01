"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { api, type Dispute, type Evidence, type Verdict } from "@/lib/api";
import { connectWallet, signTransaction } from "@/lib/stellar";

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const disputeId = params.id;

  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [content, setContent] = useState(
    "Freelancer uploaded timestamped delivery proof and reviewer notes.",
  );
  const [status, setStatus] = useState("Loading dispute state...");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDispute() {
      try {
        const [nextDispute, nextVerdict] = await Promise.all([
          api.disputes.get(disputeId),
          api.disputes.verdict(disputeId),
        ]);

        if (!active) {
          return;
        }

        setDispute(nextDispute);
        setVerdict(nextVerdict);
        setStatus("Dispute loaded. Evidence can now be signed and submitted.");
      } catch (error) {
        if (!active) {
          return;
        }

        setStatus(
          error instanceof Error ? error.message : "Unable to load dispute.",
        );
      }
    }

    void loadDispute();

    return () => {
      active = false;
    };
  }, [disputeId]);

  async function ensureWallet(): Promise<string> {
    if (walletAddress) {
      return walletAddress;
    }

    const address = await connectWallet();
    setWalletAddress(address);
    return address;
  }

  async function onSubmitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("Connecting wallet for evidence approval...");

    try {
      const address = await ensureWallet();
      setStatus("Signing evidence receipt...");

      const signed = await signTransaction(
        JSON.stringify({
          action: "submit_evidence",
          dispute_id: disputeId,
          submitted_by: address,
          content,
        }),
      );

      setSignature(signed);
      setStatus("Signature approved. Sending evidence to mocked backend...");

      const savedEvidence = await api.disputes.evidence.submit(disputeId, {
        submitted_by: address,
        content,
        file_hash: "bafybeigdyrdeterministicevidence",
      });

      setEvidence(savedEvidence);
      setStatus("Evidence stored. UI reflects the signed submission.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Evidence submission failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-950 px-6 py-10 text-stone-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="space-y-3">
          <Link href="/jobs" className="text-sm text-amber-300 hover:text-amber-200">
            Back to jobs
          </Link>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-300">
            Dispute Workspace
          </p>
          <h1 className="text-4xl font-semibold">Dispute Verdict</h1>
          <p className="max-w-3xl text-sm text-stone-300">{status}</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-4 rounded-3xl border border-stone-800 bg-stone-900/70 p-6">
            <h2 className="text-xl font-semibold">Case Snapshot</h2>
            <dl className="space-y-3 text-sm text-stone-300">
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Dispute ID
                </dt>
                <dd className="break-all">{dispute?.id ?? disputeId}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Opened by
                </dt>
                <dd className="break-all">{dispute?.opened_by ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Verdict
                </dt>
                <dd>
                  {verdict
                    ? `${verdict.winner} · ${verdict.freelancer_share_bps} bps`
                    : "Pending"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Reasoning
                </dt>
                <dd>{verdict?.reasoning ?? "Loading..."}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Settlement Tx
                </dt>
                <dd className="break-all">{verdict?.on_chain_tx ?? "Pending"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Wallet
                </dt>
                <dd className="break-all">{walletAddress || "Not connected"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.3em] text-stone-500">
                  Signed payload
                </dt>
                <dd className="break-all font-mono text-xs text-stone-400">
                  {signature || "Awaiting wallet approval"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-3xl border border-amber-400/20 bg-amber-400/5 p-6">
            <h2 className="text-xl font-semibold">Submit Evidence</h2>
            <p className="mt-2 text-sm text-stone-300">
              The test suite injects a mock Freighter-compatible wallet and signs
              this evidence payload in-browser before the request is accepted.
            </p>

            <form onSubmit={onSubmitEvidence} className="mt-6 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-200">
                  Evidence summary
                </span>
                <textarea
                  rows={6}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 outline-none transition focus:border-amber-400"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-amber-300 px-6 py-3 font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300"
              >
                {isSubmitting ? "Submitting..." : "Sign and Submit Evidence"}
              </button>
            </form>

            {evidence ? (
              <div className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">
                  Evidence Recorded
                </p>
                <p className="mt-2 break-all text-sm text-stone-100">
                  {evidence.content}
                </p>
                <p className="mt-2 break-all font-mono text-xs text-stone-400">
                  {evidence.id}
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
