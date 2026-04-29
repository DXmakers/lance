"use client";

import { useEffect, useState } from "react";
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
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { SiteShell } from "@/components/site-shell";
import { Stars } from "@/components/stars";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { useLiveJobWorkspace } from "@/hooks/use-live-job-workspace";
import { api } from "@/lib/api";
import { releaseFunds, openDispute } from "@/lib/contracts";
import {
  formatDate,
  formatDateTime,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const workspace = useLiveJobWorkspace(id);
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [proposal, setProposal] = useState("");
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

  async function handleBid(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("bid");

    try {
      const freelancerAddress =
        (await getConnectedWalletAddress()) ?? "GD...FREELANCER";
      await api.bids.create(id, {
        freelancer_address: freelancerAddress,
        proposal,
      });
      setProposal("");
      await workspace.refresh();
    } catch {
      alert("Failed to submit bid");
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
              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <h2 className="text-xl font-semibold text-slate-950">
                  Submit a Proposal
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Pitch your approach, timing, and why your previous work maps cleanly to this brief.
                </p>
                <form onSubmit={handleBid} className="mt-5 space-y-4">
                  <textarea
                    value={proposal}
                    onChange={(event) => setProposal(event.target.value)}
                    className="min-h-[160px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none transition focus:border-amber-400"
                    placeholder="Tell the client why you're a fit..."
                    required
                    id="bid-proposal"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === "bid"}
                    className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    id="submit-bid"
                  >
                    {busyAction === "bid" ? "Submitting..." : "Submit Bid"}
                  </button>
                </form>
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
                  isClientOwner={
                    Boolean(viewerAddress) &&
                    viewerAddress === workspace.job?.client_address
                  }
                />
              </section>
            </div>
          ) : null}

          {job.status !== "open" ? (
            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">
                      Milestone Ledger
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Each milestone is time-stamped so both parties can see what is pending, submitted, and released.
                    </p>
                  </div>
                  {workspace.loading ? (
                    <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" />
                  ) : null}
                </div>

                <div className="mt-5 space-y-3">
                  {workspace.milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Milestone {milestone.index}
                          </p>
                          <p className="mt-2 text-sm font-medium text-slate-800">
                            {milestone.title}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-950">
                            {formatUsdc(milestone.amount_usdc)}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                            {milestone.status}
                          </p>
                        </div>
                      </div>
                      {milestone.released_at ? (
                        <p className="mt-3 text-xs text-slate-500">
                          Released {formatDateTime(milestone.released_at)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
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

(Content truncated due to size limit. Use line ranges to read remaining content)
