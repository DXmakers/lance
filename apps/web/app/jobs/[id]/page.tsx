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


export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const workspace = useLiveJobWorkspace(id);

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
    try {
      const acceptedJob = await api.bids.accept(id, bidId, {
        client_address: workspace.job.client_address,
      });
      await workspace.refresh();
      router.push(`/jobs/${acceptedJob.id}/fund`);
    } catch {
      alert("Failed to accept bid");
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
                  <ShareJobButton path={`/jobs/${id}`} title={job.title} />
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  {job.description}
                </p>
              </div>
              <div className="rounded-[1.6rem] border border-amber-200 bg-amber-50 p-5 text-right">
                <p className="text-xs uppercase tracking-[0.22em] text-amber-700">
                  Contract Value
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {formatUsdc(job.budget_usdc)}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {job.milestones} milestone approvals
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 rounded-[1.6rem] border border-slate-200 bg-slate-50 p-5 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Client
                </p>
                <p className="mt-2 text-sm font-medium text-slate-700">
                  {shortenAddress(job.client_address)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Freelancer
                </p>
                <p className="mt-2 text-sm font-medium text-slate-700">
                  {job.freelancer_address
                    ? shortenAddress(job.freelancer_address)
                    : "Not assigned"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Updated
                </p>
                <p className="mt-2 text-sm font-medium text-slate-700">
                  {formatDateTime(job.updated_at)}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Escrow Contract
              </p>
              <p className="mt-2 font-mono text-xs text-slate-600 break-all">
                {getEscrowContractId() || "Not configured"}
              </p>
            </div>

            {workflowLocked ? (
              <div className="mt-6 rounded-[1.6rem] border border-red-200 bg-red-50 p-5 text-red-800">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5" />
                  <div>
                    <p className="font-semibold">
                      Regular workflow is locked while the dispute center is active.
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      Deliverable uploads and release actions stay frozen until the
                      Agent Judge returns an immutable verdict.
                    </p>
                    <Link
                      href={`/jobs/${id}/dispute${workspace.dispute ? `?disputeId=${workspace.dispute.id}` : ""}`}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline"
                    >
                      Open dispute center
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {job.status === "open" ? (
            <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
              <section className="rounded-[2rem] border border-zinc-700/60 bg-zinc-950/90 p-6 shadow-[0_20px_60px_-48px_rgba(0,0,0,0.8)]">
                <h2 className="text-xl font-semibold text-zinc-50">
                  Submit a Proposal
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  Pitch your approach, timing, and why your previous work maps cleanly to this brief.
                </p>
                <div className="mt-5">
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
                  }}
                />
              </section>

              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">
                      Deliverables
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Freelancers can pin files to IPFS or share links, then the client gets a dedicated approval moment.
                    </p>
                  </div>
                  <FileUp className="h-5 w-5 text-amber-600" />
                </div>

                {!workflowLocked ? (
                  <form onSubmit={handleSubmitDeliverable} className="mt-5 space-y-4">
                    <input
                      value={deliverableLabel}
                      onChange={(event) => setDeliverableLabel(event.target.value)}
                      placeholder="Submission title"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                    />
                    <input
                      value={deliverableLink}
                      onChange={(event) => setDeliverableLink(event.target.value)}
                      placeholder="GitHub repo, Figma file, hosted ZIP link, or leave blank to upload a file"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                    />
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <FileUp className="h-4 w-4 text-amber-600" />
                      <span>{deliverableFile ? deliverableFile.name : "Upload ZIP, image, JSON, or PDF evidence"}</span>
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
                      className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busyAction === "deliverable"
                        ? "Submitting..."
                        : "Submit Milestone"}
                    </button>
                  </form>
                ) : null}

                <div className="mt-5 space-y-3">
                  {workspace.deliverables.length === 0 ? (
                    <EmptyState
                      icon={<FileUp className="h-5 w-5" />}
                      title="No milestone evidence yet"
                      description="Submitted files and links will appear here once a freelancer shares delivery proof."
                      className="rounded-[1.4rem] bg-slate-50 py-8"
                    />
                  ) : (
                    workspace.deliverables.map((deliverable) => (
                      <article
                        key={deliverable.id}
                        className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Milestone {deliverable.milestone_index}
                            </p>
                            <p className="mt-2 text-sm font-medium text-slate-800">
                              {deliverable.label}
                            </p>
                          </div>
                          <p className="text-xs text-slate-500">
                            {formatDateTime(deliverable.created_at)}
                          </p>
                        </div>
                        <a
                          href={deliverable.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 underline"
                        >
                          Open evidence
                        </a>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-3">
              <Wallet className="h-5 w-5 text-amber-600" />
              <h2 className="text-lg font-semibold text-slate-950">
                Connected Viewer
              </h2>
            </div>
            <p className="mt-4 text-sm text-slate-600">
              {viewerAddress ?? "No wallet connected yet."}
            </p>
            {!viewerAddress ? (
              <button
                type="button"
                onClick={() => void ensureViewerAddress()}
                className="mt-4 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
              >
                Connect wallet
              </button>
            ) : null}
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <h2 className="text-lg font-semibold text-slate-950">
              Counterparty trust
            </h2>
            <div className="mt-5 space-y-4">
              <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Client reputation
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Stars value={workspace.clientReputation?.starRating ?? 2.5} />
                  <span className="text-sm font-semibold text-slate-800">
                    {workspace.clientReputation?.averageStars.toFixed(1) ?? "2.5"}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {workspace.clientReputation?.totalJobs ?? 0} completed jobs
                </p>
              </div>

              {job.freelancer_address ? (
                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Freelancer reputation
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stars
                      value={workspace.freelancerReputation?.starRating ?? 2.5}
                    />
                    <span className="text-sm font-semibold text-slate-800">
                      {workspace.freelancerReputation?.averageStars.toFixed(1) ?? "2.5"}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {workspace.freelancerReputation?.totalJobs ?? 0} completed jobs
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {job.status === "awaiting_funding" ? (
            <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-[0_20px_60px_-48px_rgba(245,158,11,0.45)]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                Next step
              </p>
              <h2 className="mt-3 text-xl font-semibold">Fund the escrow</h2>
              <p className="mt-3 text-sm leading-6">
                The freelancer is locked in. Deposit funds to transition the contract into active execution.
              </p>
              <Link
                href={`/jobs/${id}/fund`}
                className="mt-5 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
              >
                Open funding review
              </Link>
            </section>
          ) : null}

          {job.status !== "open" && job.status !== "awaiting_funding" ? (
            <section className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.8)]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                Client control room
              </p>
              <h2 className="mt-3 text-xl font-semibold">
                Awaiting Client Approval
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Approve the latest submitted milestone, or escalate to a dispute if the evidence does not satisfy the brief.
              </p>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={handleReleaseFunds}
                  disabled={
                    workflowLocked ||
                    job.status !== "deliverable_submitted" ||
                    !nextMilestone ||
                    busyAction === "release"
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-800/50"
                  id="release-funds"
                >
                  {busyAction === "release" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Approve &amp; Release Funds
                </button>
                <button
                  type="button"
                  onClick={handleOpenDispute}
                  disabled={workflowLocked || busyAction === "dispute"}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === "dispute" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Gavel className="h-4 w-4" />
                  )}
                  Reject &amp; Initiate Dispute
                </button>
              </div>
            </section>
          ) : null}

          <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
            <h2 className="text-lg font-semibold text-slate-950 mb-5">
              Activity Pulse
            </h2>
            <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <ActivityLogList jobId={id} />
            </div>
          </section>
        </aside>
      </section>
    </SiteShell>
  );
}

