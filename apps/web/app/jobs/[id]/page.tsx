"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  FileUp,
  ShieldAlert,
  Wallet,
  Clock,
  ArrowRightLeft,
  Info,
  ShieldCheck,
  Zap,
  Phone,
  AlertCircle
} from "lucide-react";
import { BidList } from "@/components/jobs/bid-list";
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { SiteShell } from "@/components/site-shell";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { useLiveJobWorkspace } from "@/hooks/use-live-job-workspace";
import { api } from "@/lib/api";
import { releaseFunds, getEscrowContractId } from "@/lib/contracts";
import {
  formatDateTime,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

import { TransactionPipeline } from "@/components/blockchain/transaction-pipeline";
import { MilestoneTracker } from "@/components/jobs/milestone-tracker";
import { SubmitBidErrorBoundary } from "@/components/jobs/submit-bid-error-boundary";
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { useAcceptBid } from "@/hooks/use-accept-bid";

function MetadataCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
        {label}
      </p>
      <p className={`font-mono text-sm font-medium ${accent ? 'text-indigo-600' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  );
}

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();

  const workspace = useLiveJobWorkspace(id);
  const { transaction: acceptTransaction } = useAcceptBid();

  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [deliverableLabel, setDeliverableLabel] = useState("");
  const [deliverableLink, setDeliverableLink] = useState("");
  const [deliverableFile, setDeliverableFile] = useState<File | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    void getConnectedWalletAddress().then(setViewerAddress);
  }, []);

  async function ensureViewerAddress() {
    if (viewerAddress) return viewerAddress;
    const connected = await connectWallet();
    setViewerAddress(connected);
    return connected;
  }

  const handleAcceptBid = useCallback(async (bidId: string) => {
    if (!workspace.job) return;
    setBusyAction(`accept-${bidId}`);
    try {
      // Logic for accepting bid would go here
      // For now we refresh
      await workspace.refresh();
    } finally {
      setBusyAction(null);
    }
  }, [workspace]);

  async function handleSubmitDeliverable(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace.job) return;
    setBusyAction("deliverable");

    try {
      const submitter =
        workspace.job.freelancer_address ??
        (await ensureViewerAddress()) ??
        "GD...FREELANCER";

      let url = deliverableLink;
      let fileHash: string | undefined;
      let kind = deliverableLink ? "link" : "file";

      if (deliverableFile) {
        const upload = await api.uploads.pin(deliverableFile);
        url = `ipfs://${upload.cid}`;
        fileHash = upload.cid;
        kind = "file";
      }

      await api.jobs.deliverables.submit(id, {
        submitted_by: submitter,
        label: deliverableLabel || "Milestone submission",
        kind,
        url,
        file_hash: fileHash,
      });

      setDeliverableFile(null);
      setDeliverableLabel("");
      setDeliverableLink("");
      await workspace.refresh();
    } catch {
      alert("Failed to submit deliverable");
    } finally {
      setBusyAction(null);
    }
  }

  if (workspace.loading && !workspace.job) {
    return (
      <SiteShell
        eyebrow="Job Overview"
        title="Loading workspace"
        description="Fetching counterparties, milestones, deliverables, and dispute state."
      >
        <JobDetailsSkeleton />
      </SiteShell>
    );
  }

  if (!workspace.job) {
    return (
      <SiteShell
        eyebrow="Job Overview"
        title="Workspace unavailable"
        description={workspace.error ?? "We couldn't load that job."}
      >
        <div className="rounded-[2rem] border border-red-200 bg-red-50 p-6 text-red-700">
          {workspace.error ?? "Job not found."}
        </div>
      </SiteShell>
    );
  }

  const job = workspace.job;
  const viewerBid = viewerAddress
    ? workspace.bids.find(
        (bid) =>
          bid.freelancer_address === viewerAddress && bid.status === "pending",
      )
    : null;
  const isClientOwner = Boolean(
    viewerAddress && viewerAddress === job.client_address,
  );
  const workflowLocked = job.status === "disputed" || workspace.dispute !== null;

  return (
    <SiteShell
      eyebrow="Job Overview"
      title={job.title}
      description="A shared contract workspace for bids, deliverables, approvals, and escalation."
    >
      <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                  Status
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
                    {job.title}
                  </h1>
                  <span className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white">
                    {job.status}
                  </span>
                  <div className="ml-auto">
                    <SaveJobButton jobId={job.id} />
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-4 border-t border-slate-100 pt-8 sm:grid-cols-3">
                <MetadataCard label="Client" value={shortenAddress(job.client_address)} />
                <MetadataCard label="Freelancer" value={job.freelancer_address ? shortenAddress(job.freelancer_address) : "Unassigned"} accent={!!job.freelancer_address} />
                <MetadataCard label="Last Pulse" value={formatDateTime(job.updated_at)} />
              </div>

              <div className="mt-6 rounded-[8px] border border-zinc-800 bg-zinc-950/50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Escrow Authority
                </p>
                <p className="mt-2 font-mono text-[11px] text-zinc-400 break-all">
                  {getEscrowContractId() || "System Default"}
                </p>
              </div>

              {workflowLocked ? (
                <div className="mt-8 rounded-[12px] border border-red-500/20 bg-red-500/5 p-6 text-red-400">
                  <div className="flex items-start gap-4">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-sm font-bold uppercase tracking-tight">
                        Protocol Safety Lock Active
                      </p>
                      <p className="mt-2 text-[13px] leading-relaxed text-red-400/80">
                        Workflows are suspended while the dispute center is active.
                        Actions stay frozen until a resolution is reached.
                      </p>
                      <Link
                        href={`/jobs/${id}/dispute${workspace.dispute ? `?disputeId=${workspace.dispute.id}` : ""}`}
                        className="mt-4 inline-flex items-center gap-2 text-xs font-bold underline decoration-red-500/30 underline-offset-4 hover:decoration-red-500"
                      >
                        Enter Dispute Center
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {job.status === "open" && (
            <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
              <section className="rounded-[2rem] border border-zinc-700/60 bg-zinc-950/90 p-6 shadow-[0_20px_60px_-48px_rgba(0,0,0,0.8)]">
                <h2 className="text-xl font-semibold text-zinc-50">
                  Submit a Proposal
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  Pitch your approach, timing, and why your previous work maps cleanly to this brief.
                </p>
                {isClientOwner && (
                  <div className="mt-5 rounded-[1.6rem] border border-slate-700/40 bg-slate-900/80 p-5 text-sm text-slate-200">
                    <p className="font-semibold text-slate-100">Clients cannot submit proposals</p>
                    <p className="mt-2 text-slate-300/90">
                      This job is owned by your account. Freelancers can submit bids and you can accept the strongest proposal from the shortlist.
                    </p>
                  </div>
                )}
                {viewerBid && (
                  <div className="mt-5 rounded-[1.6rem] border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
                    <p className="font-semibold text-amber-200">Your bid is pending review</p>
                    <p className="mt-2 text-amber-100/90">
                      You have already submitted a proposal for this job. The client is reviewing your pitch and will assign the winning freelancer once a bid is accepted.
                    </p>
                  </div>
                )}
                {!isClientOwner && (
                  <div className="mt-5">
                    <SubmitBidErrorBoundary>
                      <SubmitBidModal
                        jobId={id}
                        onChainJobId={BigInt(workspace.job?.on_chain_job_id ?? 0)}
                        disabled={Boolean(viewerBid) || busyAction !== null}
                        onSubmitted={workspace.refresh}
                      />
                    </SubmitBidErrorBoundary>
                  </div>
                )}
              </section>

              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-950">
                    Bids ({workspace.bids.length})
                  </h2>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Client shortlist
                  </span>
                </div>
                <BidList
                  job={job}
                  bids={workspace.bids}
                  isClientOwner={isClientOwner}
                  onAccept={handleAcceptBid}
                />
                {acceptTransaction.step !== "idle" && (
                  <div className="mt-6 rounded-[1.6rem] border border-indigo-600/20 bg-indigo-950/10 p-5">
                    <h3 className="text-sm font-semibold text-indigo-100">
                      Accept bid transaction
                    </h3>
                    <p className="mt-2 text-sm text-indigo-200">
                      The platform is building and confirming the on-chain accept_bid call for this selected freelancer.
                    </p>
                    <div className="mt-4">
                      <TransactionPipeline
                        step={acceptTransaction.step}
                        txHash={acceptTransaction.txHash}
                        message={acceptTransaction.message}
                        error={acceptTransaction.error}
                        unsignedXdr={acceptTransaction.unsignedXdr}
                        signedXdr={acceptTransaction.signedXdr}
                        simulationLog={acceptTransaction.simulationLog}
                      />
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {job.status !== "open" && (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <section className="space-y-6">
                <MilestoneTracker
                  milestones={workspace.milestones}
                  deliverables={workspace.deliverables}
                  jobStatus={job.status}
                  loading={workspace.loading}
                  isClient={isClientOwner}
                  workflowLocked={workflowLocked}
                  busyMilestoneId={
                    busyAction?.startsWith("release-")
                      ? busyAction.replace("release-", "")
                      : null
                  }
                  onRelease={async (milestoneId) => {
                    if (!workspace.job) return;
                    const milestone = workspace.milestones.find(
                      (m) => m.id === milestoneId,
                    );
                    if (!milestone) return;
                    setBusyAction(`release-${milestoneId}`);
                    try {
                      await releaseFunds(
                        BigInt(workspace.job.on_chain_job_id ?? 0),
                        Math.max(0, milestone.index - 1),
                      );
                      await api.jobs.releaseMilestone(id, milestoneId);
                      await workspace.refresh();
                    } catch {
                      alert("Failed to release milestone");
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                />

                <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-950">
                        Evidence Submission
                      </h2>
                      <p className="mt-2 text-[12px] leading-relaxed text-slate-500">
                        Pin deliverables to IPFS to trigger a formal approval moment.
                      </p>
                    </div>
                    <FileUp className="h-5 w-5 text-indigo-400" />
                  </div>

                  {!workflowLocked && (
                    <form onSubmit={handleSubmitDeliverable} className="mt-5 space-y-4">
                      <input
                        value={deliverableLabel}
                        onChange={(event) => setDeliverableLabel(event.target.value)}
                        placeholder="Submission title"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-400"
                      />
                      <input
                        value={deliverableLink}
                        onChange={(event) => setDeliverableLink(event.target.value)}
                        placeholder="GitHub repo, Figma file, or hosted ZIP link"
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-400"
                      />
                      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        <FileUp className="h-4 w-4 text-indigo-600" />
                        <span>{deliverableFile ? deliverableFile.name : "Upload ZIP, image, or PDF evidence"}</span>
                        <input
                          type="file"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) setDeliverableFile(file);
                          }}
                          className="hidden"
                          id="deliverable-file"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busyAction !== null}
                        className="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyAction === "deliverable" ? "Submitting..." : "Submit Evidence"}
                      </button>
                    </form>
                  )}
                </section>
              </section>

              <aside className="space-y-6">
                <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400">Budget Details</h3>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-slate-950">{formatUsdc(job.budget_usdc)}</span>
                    <span className="text-sm font-medium text-slate-500 uppercase">USDC</span>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
