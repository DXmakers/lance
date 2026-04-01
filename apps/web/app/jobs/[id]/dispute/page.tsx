"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  FileWarning,
  LoaderCircle,
  Scale,
} from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { api, type Dispute, type Evidence, type Job, type Verdict } from "@/lib/api";
import { formatDateTime, formatUsdc, shortenAddress } from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

const STELLAR_EXPLORER_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

export default function JobDisputeCenterPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const disputeId = searchParams.get("disputeId");
  const [job, setJob] = useState<Job | null>(null);
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getConnectedWalletAddress().then(setViewerAddress);
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const nextJob = await api.jobs.get(id);
        const nextDispute = disputeId
          ? await api.disputes.get(disputeId)
          : await api.jobs.dispute.get(id);
        const [nextEvidence, nextVerdict] = await Promise.all([
          api.disputes.evidence.list(nextDispute.id).catch(() => []),
          api.disputes.verdict(nextDispute.id).catch(() => null),
        ]);

        if (!active) return;
        setJob(nextJob);
        setDispute(nextDispute);
        setEvidence(nextEvidence);
        setVerdict(nextVerdict);
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load dispute center.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 6000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [disputeId, id]);

  async function ensureViewer() {
    if (viewerAddress) return viewerAddress;
    const connected = await connectWallet();
    setViewerAddress(connected);
    return connected;
  }

  async function handleSubmitEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!dispute) return;
    setBusy(true);

    try {
      const actor = await ensureViewer();
      let fileHash: string | undefined;

      if (attachment) {
        const upload = await api.uploads.pin(attachment);
        fileHash = upload.cid;
      }

      await api.disputes.evidence.submit(dispute.id, {
        submitted_by: actor,
        content: statement,
        file_hash: fileHash,
      });

      setStatement("");
      setAttachment(null);
      setEvidence(await api.disputes.evidence.list(dispute.id));
    } catch {
      alert("Failed to submit evidence");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SiteShell
        eyebrow="Dispute Center"
        title="Loading dispute center"
        description="Pulling evidence, current status, and any available verdict."
      >
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white/70" />
      </SiteShell>
    );
  }

  if (!job || !dispute) {
    return (
      <SiteShell
        eyebrow="Dispute Center"
        title="No active dispute found"
        description={error ?? "Raise a dispute from the job overview first."}
      >
        <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-amber-900">
          {error ?? "This job has not entered dispute resolution yet."}
        </div>
      </SiteShell>
    );
  }

  const freelancerShare = verdict ? verdict.freelancer_share_bps / 100 : null;
  const clientShare = verdict ? (10000 - verdict.freelancer_share_bps) / 100 : null;

  return (
    <SiteShell
      eyebrow="Dispute Center"
      title={`Dispute Center for ${job.title}`}
      description="This route functions like a courtroom record: the workflow is locked, every evidence item is time-stamped, and the final payout split is surfaced with the AI judge reasoning."
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 shadow-[0_25px_80px_-48px_rgba(239,68,68,0.25)]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
              <div>
                <h2 className="text-xl font-semibold text-red-900">
                  Regular workflow is fully locked
                </h2>
                <p className="mt-3 text-sm leading-6 text-red-800">
                  While this dispute is open, Lance freezes milestone approvals and
                  standard execution actions. The Agent Judge reviews the original
                  brief, submitted evidence, and both parties&apos; written context.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Docket
                </p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">
                  Evidence submissions
                </h2>
              </div>
              <span className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                {dispute.status}
              </span>
            </div>

            <form onSubmit={handleSubmitEvidence} className="mt-5 space-y-4">
              <textarea
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                placeholder="Explain your defense or grievance with specifics the judge can audit."
                className="min-h-[160px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                required
              />
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <FileWarning className="h-4 w-4 text-amber-600" />
                <span>{attachment ? attachment.name : "Attach supporting evidence"}</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) =>
                    setAttachment(event.target.files?.[0] ?? null)
                  }
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Submitting..." : "Submit Evidence"}
              </button>
            </form>

            <div className="mt-6 space-y-4">
              {evidence.length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No evidence has been submitted yet.
                </div>
              ) : (
                evidence.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {shortenAddress(entry.submitted_by)}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-slate-700">
                          {entry.content}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                    {entry.file_hash ? (
                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${entry.file_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 underline"
                      >
                        Open attached evidence
                      </a>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Neutral summary
            </p>
            <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-4">
                <span>Opened by</span>
                <span className="font-medium">{shortenAddress(dispute.opened_by)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Created</span>
                <span className="font-medium">{formatDateTime(dispute.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Contract value</span>
                <span className="font-medium">{formatUsdc(job.budget_usdc)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.8)]">
            <div className="flex items-center gap-3">
              <Scale className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-semibold">Verdict Summary</h2>
            </div>

            {!verdict ? (
              <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                <div className="flex items-center gap-3">
                  <LoaderCircle className="h-4 w-4 animate-spin text-amber-300" />
                  Agent Judge reasoning is still pending.
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                    Liability
                  </p>
                  <p className="mt-3 text-2xl font-semibold capitalize">
                    {verdict.winner}
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                    Payout Split
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-200">
                    Freelancer: <strong>{freelancerShare}%</strong>
                    <br />
                    Client: <strong>{clientShare}%</strong>
                  </p>
                </div>
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                    Reasoning
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-200">
                    {verdict.reasoning}
                  </p>
                </div>
                {verdict.on_chain_tx ? (
                  <a
                    href={`${STELLAR_EXPLORER_URL}/${verdict.on_chain_tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300 underline"
                  >
                    View payout transaction
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <h2 className="text-lg font-semibold text-slate-950">
              Related workspace
            </h2>
            <Link
              href={`/jobs/${id}`}
              className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 underline"
            >
              Return to job overview
            </Link>
          </section>
        </aside>
      </div>
    </SiteShell>
  );
}
