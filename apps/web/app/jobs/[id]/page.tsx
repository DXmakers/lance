"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileUp,
  Gavel,
  LoaderCircle,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { BidList } from "@/components/jobs/bid-list";
import { MilestoneTracker } from "@/components/jobs/milestone-tracker";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { SubmitBidErrorBoundary } from "@/components/jobs/submit-bid-error-boundary";
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { SiteShell } from "@/components/site-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Stars } from "@/components/stars";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { useLiveJobWorkspace } from "@/hooks/use-live-job-workspace";
import { api } from "@/lib/api";
import { releaseFunds, openDispute, getEscrowContractId } from "@/lib/contracts";
import {
  formatDateTime,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

import { ActivityLogList } from "@/components/activity-log";
import { TransactionPipeline } from "@/components/blockchain/transaction-pipeline";
import { useAcceptBid } from "@/hooks/use-accept-bid";


export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const workspace = useLiveJobWorkspace(id);
  const { accept, transaction: acceptTransaction } = useAcceptBid();

  // useLiveJobWorkspace provides data and a `refresh()` helper
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
  
  async function handleAcceptBid(bidId: string) {
    if (!workspace.job) return;
    const bid = workspace.bids.find((item) => item.id === bidId);
    if (!bid) return;

    setBusyAction(`accept-${bidId}`);
    try {
      const result = await accept({
        jobId: id,
        onChainJobId: BigInt(workspace.job.on_chain_job_id ?? 0),
        bidId,
        freelancerAddress: bid.freelancer_address,
      });

      if (!result) {
        throw new Error("Unable to confirm bid acceptance.");
      }

      await workspace.refresh();
      router.push(`/jobs/${result.acceptedJob.id}/fund`);
    } catch {
      alert("Failed to accept bid");
    } finally {
      setBusyAction(null);
    }
  }

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

  async function handleReleaseFunds() {
    if (!workspace.job) return;
    const nextMilestone = workspace.milestones.find(
      (milestone) => milestone.status === "pending",
    );
    if (!nextMilestone) return;

    setBusyAction("release");

    try {
      await releaseFunds(
        BigInt(workspace.job.on_chain_job_id ?? 0),
        Math.max(0, nextMilestone.index - 1),
      );
      await api.jobs.releaseMilestone(id, nextMilestone.id);
      await workspace.refresh();
    } catch {
      alert("Failed to release milestone");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenDispute() {
    if (!workspace.job) return;
    setBusyAction("dispute");

    try {
      const actor = (await ensureViewerAddress()) ?? workspace.job.client_address;
      await openDispute(BigInt(workspace.job.on_chain_job_id ?? 0));
      const dispute = await api.jobs.dispute.open(id, { opened_by: actor });
      router.push(`/jobs/${id}/dispute?disputeId=${dispute.id}`);
    } catch {
      alert("Failed to open dispute");
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
  const nextMilestone = workspace.milestones.find(
    (milestone) => milestone.status === "pending",
  );
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-indigo-500/30">
      <SiteShell
        eyebrow="Job Overview"
        title={job.title}
        description="A shared contract workspace for bids, deliverables, approvals, and escalation."
      >
        <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-8">
            <div className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-md sm:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-500">
                      Active Registry
                    </span>
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-white">
                      {job.title}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-zinc-800 border border-white/5 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400">
                        {job.status.replace(/_/g, " ")}
                      </span>
                      <ShareJobButton path={`/jobs/${id}`} title={job.title} />
                    </div>
                  </div>
                  <p className="max-w-2xl text-[13px] leading-relaxed text-zinc-400 font-medium">
                    {job.description}
                  </p>
                </div>
                <div className="rounded-[12px] border border-indigo-500/20 bg-indigo-500/5 p-6 text-right min-w-[200px]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-400">
                    Contract Value
                  </p>
                  <p className="mt-2 text-3xl font-bold text-white">
                    {formatUsdc(job.budget_usdc)}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-indigo-400/70">
                    {job.milestones} milestone approvals
                  </p>
                </div>
              </div>

              <div className="mt-8 grid gap-4 border-t border-white/5 pt-8 sm:grid-cols-3">
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

            {job.status === "open" ? (
              <div className="grid gap-8 xl:grid-cols-[1fr_0.95fr]">
                <section className="rounded-[12px] border border-indigo-500/30 bg-indigo-500/5 p-8 shadow-[0_20px_60px_-48px_rgba(0,0,0,0.8)]">
                  <h2 className="text-xl font-bold text-white">
                    Secure This Project
                  </h2>
                  <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                    Pitch your technical approach and previous on-chain experience to the client.
                  </p>
                  <div className="mt-6">
                    <SubmitBidErrorBoundary>
                      <SubmitBidModal
                        jobId={id}
                        onChainJobId={BigInt(workspace.job?.on_chain_job_id ?? 0)}
                        disabled={busyAction !== null}
                        onSubmitted={workspace.refresh}
                      />
                    </SubmitBidErrorBoundary>
                  </div>
                </section>

                <section className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-8 backdrop-blur-md">
                  <div className="mb-6 flex items-center justify-between gap-4">
                    <h2 className="text-xl font-bold text-white">
                      Bids
                    </h2>
                    <span className="rounded-full bg-zinc-800/80 px-3 py-1 text-[10px] font-bold text-zinc-500">
                      {workspace.bids.length} Proposals
                    </span>
                  </div>
                  <BidList
                    bids={workspace.bids}
                    isClientOwner={
                      Boolean(viewerAddress) &&
                      viewerAddress === workspace.job?.client_address
                    }
                    jobStatus={job.status}
                    acceptingBidId={
                      busyAction?.startsWith("accept-")
                        ? busyAction.replace("accept-", "")
                        : null
                    }
                    onAccept={handleAcceptBid}
                  />
                </section>
              </div>
            ) : null}

          {job.status === "open" ? (
            <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
              <section className="rounded-[2rem] border border-zinc-700/60 bg-zinc-950/90 p-6 shadow-[0_20px_60px_-48px_rgba(0,0,0,0.8)]">
                <h2 className="text-xl font-semibold text-zinc-50">
                  Submit a Proposal
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  Pitch your approach, timing, and why your previous work maps cleanly to this brief.
                </p>
                {isClientOwner ? (
                  <div className="mt-5 rounded-[1.6rem] border border-slate-700/40 bg-slate-900/80 p-5 text-sm text-slate-200">
                    <p className="font-semibold text-slate-100">Clients cannot submit proposals</p>
                    <p className="mt-2 text-slate-300/90">
                      This job is owned by your account. Freelancers can submit bids and you can accept the strongest proposal from the shortlist.
                    </p>
                  </div>
                ) : null}
                {viewerBid ? (
                  <div className="mt-5 rounded-[1.6rem] border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
                    <p className="font-semibold text-amber-200">Your bid is pending review</p>
                    <p className="mt-2 text-amber-100/90">
                      You have already submitted a proposal for this job. The client is reviewing your pitch and will assign the winning freelancer once a bid is accepted.
                    </p>
                  </div>
                ) : null}
                {!isClientOwner ? (
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
                ) : null}
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
                  bids={workspace.bids}
                  isClientOwner={
                    Boolean(viewerAddress) &&
                    viewerAddress === workspace.job?.client_address
                  }
                  jobStatus={job.status}
                  acceptingBidId={
                    busyAction?.startsWith("accept-")
                      ? busyAction.replace("accept-", "")
                      : null
                  }
                  onAccept={handleAcceptBid}
                />
                {acceptTransaction.step !== "idle" ? (
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
                ) : null}
              </section>
            </div>
          ) : null}

          {job.status !== "open" ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <section>
                <MilestoneTracker
                  milestones={workspace.milestones}
                  deliverables={workspace.deliverables}
                  jobStatus={job.status}
                  loading={workspace.loading}
                  isClient={
                    Boolean(viewerAddress) &&
                    viewerAddress === job.client_address
                  }
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
                </section>

                <section className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-8 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        Evidence Submission
                      </h2>
                      <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
                        Pin deliverables to IPFS to trigger a formal approval moment.
                      </p>
                    </div>
                    <FileUp className="h-5 w-5 text-indigo-400" />
                  </div>

                  {!workflowLocked ? (
                    <form onSubmit={handleSubmitDeliverable} className="mt-8 space-y-4">
                      <input
                        value={deliverableLabel}
                        onChange={(event) => setDeliverableLabel(event.target.value)}
                        placeholder="Milestone title (e.g. Phase 1 Completion)"
                        className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                      />
                      <input
                        value={deliverableLink}
                        onChange={(event) => setDeliverableLink(event.target.value)}
                        placeholder="Evidence Link (GitHub, Figma, etc)"
                        className="w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-white outline-none transition-all duration-150 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                      />
                      <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-zinc-800 bg-zinc-950/30 px-4 py-3 text-xs text-zinc-500 transition-colors hover:border-zinc-700">
                        <FileUp className="h-4 w-4 text-indigo-400" />
                        <span className="truncate">{deliverableFile ? deliverableFile.name : "Attach technical artifacts"}</span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={(event) =>
                            setDeliverableFile(event.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busyAction === "deliverable"}
                        className="w-full rounded-[12px] bg-zinc-100 px-5 py-3 text-xs font-bold text-zinc-950 transition-all duration-150 hover:bg-white disabled:opacity-50 active:scale-[0.98]"
                      >
                        {busyAction === "deliverable"
                          ? "Securing Deliverable..."
                          : "Seal & Submit Milestone"}
                      </button>
                    </form>
                  ) : null}

                  <div className="mt-8 space-y-4">
                    {workspace.deliverables.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-zinc-800 bg-zinc-950/20 p-8 text-center">
                        <FileUp className="mb-3 h-6 w-6 text-zinc-700" />
                        <p className="text-xs font-medium text-zinc-500">No submissions recorded yet.</p>
                      </div>
                    ) : (
                      workspace.deliverables.map((deliverable) => (
                        <article
                          key={deliverable.id}
                          className="rounded-[12px] border border-zinc-800 bg-zinc-950/40 p-4 transition-colors hover:border-zinc-700"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                Phase {deliverable.milestone_index}
                              </p>
                              <p className="mt-1 text-sm font-bold text-zinc-200">
                                {deliverable.label}
                              </p>
                            </div>
                            <time className="text-[10px] font-medium text-zinc-600">
                              {formatDateTime(deliverable.created_at)}
                            </time>
                          </div>
                          <a
                            href={deliverable.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-4 inline-flex items-center gap-2 text-[11px] font-bold text-indigo-400 transition-colors hover:text-indigo-300"
                          >
                            Review Payload
                          </a>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          <aside className="space-y-8">
            <section className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <Wallet className="h-4 w-4 text-indigo-400" />
                <h2 className="text-xs font-bold uppercase tracking-widest text-white">
                  Protocol Access
                </h2>
              </div>
              <div className="mt-6 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-600">Active Identity</span>
                <p className="font-mono text-xs text-zinc-400 break-all leading-relaxed">
                  {viewerAddress ?? "No authority identified"}
                </p>
              </div>
              {!viewerAddress ? (
                <button
                  type="button"
                  onClick={() => void ensureViewerAddress()}
                  className="mt-6 w-full rounded-[12px] border border-zinc-800 bg-zinc-950/50 py-2.5 text-[11px] font-bold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white"
                >
                  Authorize Identity
                </button>
              ) : null}
            </section>

            <section className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-6 backdrop-blur-md">
              <h2 className="text-xs font-bold uppercase tracking-widest text-white">
                Network Trust Score
              </h2>
              <div className="mt-6 space-y-6">
                <ReputationCard label="Client Integrity" reputation={workspace.clientReputation} />
                {job.freelancer_address ? (
                  <ReputationCard label="Freelancer Performance" reputation={workspace.freelancerReputation} />
                ) : null}
              </div>
            </section>

            {job.status === "awaiting_funding" ? (
              <section className="rounded-[12px] border border-amber-500/20 bg-amber-500/5 p-8 text-amber-400">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Crucial Action</span>
                </div>
                <h2 className="mt-3 text-xl font-bold text-white">Fund Escrow</h2>
                <p className="mt-3 text-[13px] leading-relaxed text-amber-400/80">
                  Negotiations complete. Commit funds to start the active contract workflow.
                </p>
                <Link
                  href={`/jobs/${id}/fund`}
                  className="mt-6 flex w-full items-center justify-center rounded-[12px] bg-amber-500 px-5 py-3 text-xs font-bold text-zinc-950 transition-all hover:bg-amber-400 active:scale-[0.98]"
                >
                  Initiate Funding
                </Link>
              </section>
            ) : null}

            {job.status !== "open" && job.status !== "awaiting_funding" ? (
              <section className="rounded-[12px] border border-indigo-500/30 bg-zinc-950 p-8 text-white shadow-[0_20px_60px_-48px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Governance Portal</span>
                </div>
                <h2 className="mt-3 text-xl font-bold">
                  Client Decisions
                </h2>
                <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
                  Validate delivery evidence or escalate to arbitration via the dispute system.
                </p>
                <div className="mt-8 space-y-3">
                  <button
                    type="button"
                    onClick={handleReleaseFunds}
                    disabled={
                      workflowLocked ||
                      job.status !== "deliverable_submitted" ||
                      !nextMilestone ||
                      busyAction === "release"
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-emerald-600 px-5 py-3 text-xs font-bold text-white transition-all hover:bg-emerald-500 disabled:opacity-30 disabled:grayscale active:scale-[0.98]"
                    id="release-funds"
                  >
                    {busyAction === "release" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Approve & Release
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenDispute}
                    disabled={workflowLocked || busyAction === "dispute"}
                    className="flex w-full items-center justify-center gap-2 rounded-[12px] border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-xs font-bold text-zinc-300 transition-all hover:bg-zinc-800 active:scale-[0.98]"
                  >
                    {busyAction === "dispute" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Gavel className="h-4 w-4" />
                    )}
                    Signal Dispute
                  </button>
                </div>
              </section>
            ) : null}

            <section className="rounded-[12px] border border-zinc-800/50 bg-zinc-900/40 p-8 backdrop-blur-md">
              <h2 className="text-xs font-bold uppercase tracking-widest text-white mb-8">
                Activity Pulse
              </h2>
              <div className="max-h-[600px] overflow-y-auto pr-4 custom-scrollbar">
                <ActivityLogList jobId={id} />
              </div>
            </section>
          </aside>
        </section>
      </SiteShell>
    </div>
  );
}

function MetadataCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
        {label}
      </p>
      <p className={cn("text-xs font-bold tracking-tight", accent ? "text-indigo-400" : "text-zinc-300")}>
        {value}
      </p>
    </div>
  );
}

function ReputationCard({ label, reputation }: { label: string; reputation: any }) {
  return (
    <div className="rounded-[8px] border border-zinc-800 bg-zinc-950/30 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        {label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-4">
        <Stars value={reputation?.starRating ?? 2.5} />
        <span className="text-[11px] font-bold text-zinc-200">
          {reputation?.averageStars.toFixed(1) ?? "2.5"}
        </span>
      </div>
      <p className="mt-3 text-[10px] font-medium text-zinc-600">
        Based on {reputation?.totalJobs ?? 0} confirmed engagements
      </p>
    </div>
  );
}

