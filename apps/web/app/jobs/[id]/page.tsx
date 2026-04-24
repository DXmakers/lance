"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock3,
  FileUp,
  Gavel,
  LoaderCircle,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { BidList } from "@/components/jobs/bid-list";
import { JobCardErrorBoundary } from "@/components/jobs/job-card-error-boundary";
import { Stars } from "@/components/stars";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { useJob, useJobMilestones, useJobBids, useJobDeliverables, useCreateBid, useSubmitDeliverable, useReleaseMilestone } from "@/hooks/use-job";
import { api } from "@/lib/api";
import { releaseFunds, openDispute, getEscrowContractId } from "@/lib/contracts";
import {
  formatDate,
  formatDateTime,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";
import { z } from "zod";

const deliverableSchema = z.object({
  label: z.string().min(1, "Label is required"),
  url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  kind: z.enum(["link", "file"]),
  file_hash: z.string().optional(),
});

type DeliverableFormData = z.infer<typeof deliverableSchema>;

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [deliverableLabel, setDeliverableLabel] = useState("");
  const [deliverableLink, setDeliverableLink] = useState("");
  const [deliverableFile, setDeliverableFile] = useState<File | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const { data: job, isLoading: jobLoading, error: jobError, refetch: refreshJob } = useJob(id);
  const { data: milestones = [], isLoading: milestonesLoading } = useJobMilestones(id);
  const { data: bids = [], isLoading: bidsLoading } = useJobBids(id);
  const { data: deliverables = [], isLoading: deliverablesLoading } = useJobDeliverables(id);

  const createBidMutation = useCreateBid();
  const submitDeliverableMutation = useSubmitDeliverable();
  const releaseMilestoneMutation = useReleaseMilestone();

  const loading = jobLoading || milestonesLoading;
  const error = jobError instanceof Error ? jobError.message : null;

  async function ensureViewerAddress() {
    if (viewerAddress) return viewerAddress;
    const connected = await connectWallet();
    setViewerAddress(connected);
    return connected;
  }

  async function handleAcceptBid(bidId: string) {
    if (!job) return;
    setBusyAction(`accept-${bidId}`);

    try {
      const acceptedJob = await api.bids.accept(id, bidId, {
        client_address: job.client_address,
      });
      void refreshJob();
      router.push(`/jobs/${acceptedJob.id}/fund`);
    } catch {
      alert("Failed to accept bid");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSubmitDeliverable(event: React.FormEvent) {
    event.preventDefault();
    if (!job) return;

    const data: DeliverableFormData = {
      label: deliverableLabel || "Milestone submission",
      url: deliverableLink,
      kind: deliverableLink ? "link" : "file",
    };

    const parsed = deliverableSchema.safeParse(data);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        errors[path] = issue.message;
      }
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setBusyAction("deliverable");

    try {
      const submitter =
        job.freelancer_address ??
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
    } catch {
      alert("Failed to submit deliverable");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReleaseFunds() {
    if (!job) return;
    const nextMilestone = milestones.find(
      (milestone) => milestone.status === "pending",
    );
    if (!nextMilestone) return;

    setBusyAction("release");

    try {
      await releaseFunds(
        BigInt(job.on_chain_job_id ?? 0),
        Math.max(0, nextMilestone.index - 1),
      );
      await api.jobs.releaseMilestone(id, nextMilestone.id);
      void refreshJob();
    } catch {
      alert("Failed to release milestone");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenDispute() {
    if (!job) return;
    setBusyAction("dispute");

    try {
      const actor = (await ensureViewerAddress()) ?? job.client_address;
      await openDispute(BigInt(job.on_chain_job_id ?? 0));
      const dispute = await api.jobs.dispute.open(id, { opened_by: actor });
      router.push(`/jobs/${id}/dispute?disputeId=${dispute.id}`);
    } catch {
      alert("Failed to open dispute");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && !job) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-500">
              Job Overview
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
              Loading workspace
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Fetching counterparties, milestones, deliverables, and dispute state.
            </p>
          </div>
          <JobDetailsSkeleton />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-[2rem] border border-red-500/30 bg-red-500/10 p-6">
            <p className="font-semibold text-red-400">Workspace unavailable</p>
            <p className="mt-2 text-sm text-red-300">{error ?? "Job not found."}</p>
          </div>
        </div>
      </div>
    );
  }

  const nextMilestone = milestones.find(
    (milestone) => milestone.status === "pending",
  );
  const workflowLocked = job.status === "disputed";

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-500">
            Job Overview
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            {job.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            A shared contract workspace for bids, deliverables, approvals, and escalation.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)] sm:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-400">
                    Status
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-amber-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-400">
                      {job.status}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-zinc-300">
                    {job.description}
                  </p>
                </div>
                <div className="rounded-[1.6rem] border border-amber-500/30 bg-amber-500/10 p-5 text-right">
                  <p className="text-xs uppercase tracking-[0.22em] text-amber-400">
                    Contract Value
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-zinc-50">
                    {formatUsdc(job.budget_usdc)}
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    {job.milestones} milestone approvals
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 rounded-[1.6rem] border border-white/10 bg-zinc-900/60 p-5 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Client
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-300">
                    {shortenAddress(job.client_address)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Freelancer
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-300">
                    {job.freelancer_address
                      ? shortenAddress(job.freelancer_address)
                      : "Not assigned"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Updated
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-300">
                    {formatDateTime(job.updated_at)}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-zinc-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Escrow Contract
                </p>
                <p className="mt-2 font-mono text-xs text-zinc-400 break-all">
                  {getEscrowContractId() || "Not configured"}
                </p>
              </div>

              {workflowLocked ? (
                <div className="mt-6 rounded-[1.6rem] border border-red-500/30 bg-red-500/10 p-5">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 text-red-400" />
                    <div>
                      <p className="font-semibold text-red-400">
                        Regular workflow is locked while the dispute center is active.
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-300">
                        Deliverable uploads and release actions stay frozen until the
                        Agent Judge returns an immutable verdict.
                      </p>
                      <Link
                        href={`/jobs/${id}/dispute`}
                        className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-400 underline"
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
                  <div className="mt-5 text-sm text-zinc-500">
                    Use the sidebar to connect and submit your bid.
                  </div>
                </section>

                <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-zinc-50">
                      Bids ({bids.length})
                    </h2>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Client shortlist
                    </span>
                  </div>
                  <BidList
                    bids={bids}
                    isClientOwner={
                      Boolean(viewerAddress) &&
                      viewerAddress === job?.client_address
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
                <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-zinc-50">
                        Milestone Ledger
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Each milestone is time-stamped so both parties can see what is pending, submitted, and released.
                      </p>
                    </div>
                    {milestonesLoading ? (
                      <LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" />
                    ) : null}
                  </div>

                  <div className="mt-5 space-y-3">
                    {milestones.map((milestone) => (
                      <div
                        key={milestone.id}
                        className="rounded-[1.4rem] border border-white/10 bg-zinc-900/60 p-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                              Milestone {milestone.index}
                            </p>
                            <p className="mt-2 text-sm font-medium text-zinc-200">
                              {milestone.title}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-zinc-50">
                              {formatUsdc(milestone.amount_usdc)}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">
                              {milestone.status}
                            </p>
                          </div>
                        </div>
                        {milestone.released_at ? (
                          <p className="mt-3 text-xs text-zinc-500">
                            Released {formatDateTime(milestone.released_at)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-zinc-50">
                        Deliverables
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Freelancers can pin files to IPFS or share links, then the client gets a dedicated approval moment.
                      </p>
                    </div>
                    <FileUp className="h-5 w-5 text-amber-500" />
                  </div>

                  {!workflowLocked ? (
                    <form onSubmit={handleSubmitDeliverable} className="mt-5 space-y-4">
                      <div>
                        <input
                          value={deliverableLabel}
                          onChange={(event) => setDeliverableLabel(event.target.value)}
                          placeholder="Submission title"
                          className="w-full rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-zinc-100 outline-none transition focus:border-amber-500"
                        />
                        {formErrors.label && (
                          <p className="mt-1 text-xs text-red-400">{formErrors.label}</p>
                        )}
                      </div>
                      <div>
                        <input
                          value={deliverableLink}
                          onChange={(event) => setDeliverableLink(event.target.value)}
                          placeholder="GitHub repo, Figma file, hosted ZIP link, or leave blank to upload a file"
                          className="w-full rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-zinc-100 outline-none transition focus:border-amber-500"
                        />
                        {formErrors.url && (
                          <p className="mt-1 text-xs text-red-400">{formErrors.url}</p>
                        )}
                      </div>
                      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400">
                        <FileUp className="h-4 w-4 text-amber-500" />
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
                        className="w-full rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-amber-400 disabled:opacity-50"
                      >
                        {busyAction === "deliverable"
                          ? "Submitting..."
                          : "Submit Milestone"}
                      </button>
                    </form>
                  ) : null}

                  <div className="mt-5 space-y-3">
                    {deliverables.length === 0 ? (
                      <div className="rounded-[1.4rem] border border-dashed border-white/20 bg-white/5 px-4 py-8 text-center text-sm text-zinc-500">
                        No milestone evidence has been submitted yet.
                      </div>
                    ) : (
                      deliverables.map((deliverable) => (
                        <article
                          key={deliverable.id}
                          className="rounded-[1.4rem] border border-white/10 bg-zinc-900/60 p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                                Milestone {deliverable.milestone_index}
                              </p>
                              <p className="mt-2 text-sm font-medium text-zinc-200">
                                {deliverable.label}
                              </p>
                            </div>
                            <p className="text-xs text-zinc-500">
                              {formatDateTime(deliverable.created_at)}
                            </p>
                          </div>
                          <a
                            href={deliverable.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-400 underline"
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
            <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-amber-500" />
                <h2 className="text-lg font-semibold text-zinc-50">
                  Connected Viewer
                </h2>
              </div>
              <p className="mt-4 text-sm text-zinc-400">
                {viewerAddress ?? "No wallet connected yet."}
              </p>
              {!viewerAddress ? (
                <button
                  type="button"
                  onClick={() => void ensureViewerAddress()}
                  className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-amber-500/50 hover:text-zinc-100"
                >
                  Connect wallet
                </button>
              ) : null}
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <h2 className="text-lg font-semibold text-zinc-50">
                Counterparty trust
              </h2>
              <div className="mt-5 space-y-4">
                <div className="rounded-[1.4rem] border border-white/10 bg-zinc-900/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Client reputation
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stars value={2.5} />
                    <span className="text-sm font-semibold text-zinc-300">2.5</span>
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">0 completed jobs</p>
                </div>

                {job.freelancer_address ? (
                  <div className="rounded-[1.4rem] border border-white/10 bg-zinc-900/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Freelancer reputation
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Stars value={2.5} />
                      <span className="text-sm font-semibold text-zinc-300">2.5</span>
                    </div>
                    <p className="mt-3 text-xs text-zinc-500">0 completed jobs</p>
                  </div>
                ) : null}
              </div>
            </section>

            {job.status === "awaiting_funding" ? (
              <section className="rounded-[2rem] border border-amber-500/30 bg-amber-500/10 p-6 text-amber-400 shadow-[0_20px_60px_-48px_rgba(245,158,11,0.45)]">
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">
                  Next step
                </p>
                <h2 className="mt-3 text-xl font-semibold">Fund the escrow</h2>
                <p className="mt-3 text-sm leading-6 text-zinc-300">
                  The freelancer is locked in. Deposit funds to transition the contract into active execution.
                </p>
                <Link
                  href={`/jobs/${id}/fund`}
                  className="mt-5 inline-flex rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-white"
                >
                  Open funding review
                </Link>
              </section>
            ) : null}

            {job.status !== "open" && job.status !== "awaiting_funding" ? (
              <section className="rounded-[2rem] border border-white/10 bg-zinc-900/90 p-6 text-white shadow-[0_20px_60px_-48px_rgba(15,23,42,0.8)]">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">
                  Client control room
                </p>
                <h2 className="mt-3 text-xl font-semibold">
                  Awaiting Client Approval
                </h2>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
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

            <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
              <h2 className="text-lg font-semibold text-zinc-50">
                Activity pulse
              </h2>
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-zinc-900/60 px-4 py-3">
                  <span className="text-sm text-zinc-400">Next milestone</span>
                  <span className="text-sm font-semibold text-zinc-200">
                    {nextMilestone ? `#${nextMilestone.index}` : "Complete"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-zinc-900/60 px-4 py-3">
                  <span className="text-sm text-zinc-400">Last update</span>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <Clock3 className="h-4 w-4 text-amber-500" />
                    {formatDate(job.updated_at)}
                  </span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}