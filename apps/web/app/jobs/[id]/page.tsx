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
import { useQueryClient } from "@tanstack/react-query";
import { BidList } from "@/components/jobs/bid-list";
import { SubmitBidErrorBoundary } from "@/components/jobs/submit-bid-error-boundary";
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { SiteShell } from "@/components/site-shell";
import { Stars } from "@/components/stars";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import {
  useJobQuery,
  useBidsQuery,
  useMilestonesQuery,
  useDeliverablesQuery,
  useDisputeQuery,
  useReputationQuery,
  useCreateBidMutation,
  useAcceptBidMutation,
} from "@/hooks/use-queries";
import { api } from "@/lib/api";
import { releaseFunds, openDispute, getEscrowContractId } from "@/lib/contracts";
import {
  formatDate,
  formatUsdc,
  shortenAddress,
} from "@/lib/format";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";
import { cn } from "@/lib/utils";

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: job, isLoading: jobLoading, error: jobError } = useJobQuery(id);
  const { data: bids = [], isLoading: bidsLoading } = useBidsQuery(id);
  const { data: milestones = [], isLoading: milestonesLoading } = useMilestonesQuery(id);
  const { data: deliverables = [], isLoading: deliverablesLoading } = useDeliverablesQuery(id);
  const { data: dispute = null } = useDisputeQuery(id);

  const { data: clientReputation } = useReputationQuery(job?.client_address, "client");
  const { data: freelancerReputation } = useReputationQuery(job?.freelancer_address, "freelancer");

  const createBidMutation = useCreateBidMutation(id);
  const acceptBidMutation = useAcceptBidMutation(id);

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

  async function handleBid(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("bid");
    try {
      const freelancerAddress =
        (await getConnectedWalletAddress()) ?? "GD...FREELANCER";
      await createBidMutation.mutateAsync({
        freelancer_address: freelancerAddress,
        proposal,
      });
      setProposal("");
    } catch {
      alert("Failed to submit bid");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAcceptBid(bidId: string) {
    if (!job) return;
    setBusyAction(`accept-${bidId}`);
    try {
      const acceptedJob = await acceptBidMutation.mutateAsync({
        bidId,
        body: { client_address: job.client_address },
      });
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
      queryClient.invalidateQueries({ queryKey: ["deliverables", id] });
    } catch {
      alert("Failed to submit deliverable");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReleaseFunds() {
    if (!job) return;
    const nextMilestone = milestones.find(
      (m) => m.status === "pending",
    );
    if (!nextMilestone) return;

    setBusyAction("release");
    try {
      await releaseFunds(
        BigInt(job.on_chain_job_id ?? 0),
        Math.max(0, nextMilestone.index - 1),
      );
      await api.jobs.releaseMilestone(id, nextMilestone.id);
      queryClient.invalidateQueries({ queryKey: ["job", id] });
      queryClient.invalidateQueries({ queryKey: ["milestones", id] });
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
      const d = await api.jobs.dispute.open(id, { opened_by: actor });
      router.push(`/jobs/${id}/dispute?disputeId=${d.id}`);
    } catch {
      alert("Failed to open dispute");
    } finally {
      setBusyAction(null);
    }
  }

  const isLoading = jobLoading || bidsLoading || milestonesLoading || deliverablesLoading;

  if (isLoading && !job) {
    return (
      <SiteShell eyebrow="Job Overview" title="Syncing Workspace" description="Connecting to Stellar network and IPFS.">
        <JobDetailsSkeleton />
      </SiteShell>
    );
  }

  if (!job) {
    return (
      <SiteShell eyebrow="Job Overview" title="Workspace Unavailable" description="The requested contract could not be resolved.">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center text-red-400">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <h2 className="text-lg font-bold">Access Revoked or Invalid ID</h2>
          <p className="mt-2 text-sm opacity-80">{jobError?.message ?? "Check your connection and try again."}</p>
        </div>
      </SiteShell>
    );
  }

  const nextMilestone = milestones.find((m) => m.status === "pending");
  const workflowLocked = job.status === "disputed" || dispute !== null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30">
      <SiteShell
        eyebrow="Live Contract Hub"
        title={job.title}
        description="Unified workspace for secure delivery and milestone-based settlements."
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
      >
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-8">
            {/* Main Info Card */}
            <section className="relative overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-900/40 p-8 shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
              
              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-3">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Contract Active</span>
                  </div>
                  <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white lg:text-5xl">
                    {job.title}
                  </h1>
                  <p className="mt-6 text-base leading-relaxed text-zinc-400">
                    {job.description}
                  </p>
                </div>

                <div className="shrink-0 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6 text-right backdrop-blur-md">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Value Locked</span>
                  <p className="mt-2 text-4xl font-black text-white tracking-tighter">
                    {formatUsdc(job.budget_usdc)}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-zinc-500">
                    {job.milestones} Structured Milestones
                  </p>
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

              <div className="mt-10 grid gap-6 rounded-2xl border border-zinc-800/50 bg-zinc-950/30 p-6 sm:grid-cols-3">
                {[
                  { label: "Client Entity", value: shortenAddress(job.client_address) },
                  { label: "Service Provider", value: job.freelancer_address ? shortenAddress(job.freelancer_address) : "Awaiting Selection" },
                  { label: "State Consensus", value: job.status.toUpperCase(), highlight: true }
                ].map((item, idx) => (
                  <div key={idx}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">{item.label}</p>
                    <p className={cn("mt-2 text-sm font-mono font-medium", item.highlight ? "text-emerald-400" : "text-zinc-300")}>
                      {item.value}
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
                      disabled={busyAction !== null}
                      onSubmitted={workspace.refresh}
                      resolveFreelancerAddress={async () =>
                        (await getConnectedWalletAddress()) ?? "GD...FREELANCER"
                      }
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
                ))}
              </div>

              {workflowLocked && (
                <div className="mt-8 overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-6 backdrop-blur-md">
                  <div className="flex gap-4">
                    <ShieldAlert className="h-6 w-6 shrink-0 text-amber-500" />
                    <div>
                      <h3 className="text-sm font-bold text-amber-500">Workflow Frozen: Dispute in Progress</h3>
                      <p className="mt-2 text-xs leading-relaxed text-amber-500/70">
                        Arbitration is active. Deliverable submissions and fund releases are disabled until a verdict is finalized.
                      </p>
                      <Link
                        href={`/jobs/${id}/dispute${dispute ? `?disputeId=${dispute.id}` : ""}`}
                        className="mt-4 inline-flex items-center text-xs font-bold text-white hover:underline"
                      >
                        Enter Dispute Center →
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Bids Section (Only if open) */}
            {job.status === "open" && (
              <div className="grid gap-8 lg:grid-cols-2">
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 backdrop-blur-xl shadow-xl">
                  <h2 className="text-xl font-bold text-white">Proposal Entry</h2>
                  <p className="mt-2 text-sm text-zinc-500">Securely submit your scope of work and approach.</p>
                  <form onSubmit={handleBid} className="mt-8 space-y-6">
                    <textarea
                      value={proposal}
                      onChange={(e) => setProposal(e.target.value)}
                      className="min-h-[200px] w-full rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5 text-sm text-zinc-200 outline-none transition-all focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
                      placeholder="Detail your strategy, deliverables, and timeline..."
                      required
                    />
                    <button
                      type="submit"
                      disabled={busyAction === "bid"}
                      className="w-full h-12 flex items-center justify-center rounded-xl bg-white text-zinc-950 text-sm font-bold transition-all hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50"
                    >
                      {busyAction === "bid" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : "Deploy Bid"}
                    </button>
                  </form>
                </section>

                <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 backdrop-blur-xl shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <h2 className="text-xl font-bold text-white">Incoming Bids</h2>
                    <span className="px-3 py-1 rounded-full bg-zinc-800 text-[10px] font-black uppercase text-zinc-400">
                      {bids.length} Received
                    </span>
                  </div>
                  <BidList
                    bids={bids}
                    isClientOwner={viewerAddress === job.client_address}
                    jobStatus={job.status}
                    acceptingBidId={busyAction?.startsWith("accept-") ? busyAction.replace("accept-", "") : null}
                    onAccept={handleAcceptBid}
                  />
                </section>
              </div>
            )}

            {/* Post-Open Sections */}
            {job.status !== "open" && (
              <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                {/* Milestones */}
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 backdrop-blur-xl shadow-xl">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white">Milestone Matrix</h2>
                    <div className="h-8 w-8 rounded-full border border-zinc-800 bg-zinc-950 flex items-center justify-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    {milestones.map((m) => (
                      <div key={m.id} className="group relative rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 transition-all hover:bg-zinc-950/60">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Phase {m.index}</span>
                            <h3 className="mt-1 text-sm font-bold text-zinc-200">{m.title}</h3>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-white">{formatUsdc(m.amount_usdc)}</p>
                            <span className={cn(
                              "mt-1 text-[10px] font-bold uppercase",
                              m.status === "released" ? "text-emerald-500" : "text-amber-500"
                            )}>{m.status}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Deliverables */}
                <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 backdrop-blur-xl shadow-xl">
                  <h2 className="text-xl font-bold text-white mb-6">Deliverable Log</h2>
                  
                  {!workflowLocked && job.freelancer_address === viewerAddress && (
                    <form onSubmit={handleSubmitDeliverable} className="mb-8 space-y-4">
                      <input
                        value={deliverableLabel}
                        onChange={(e) => setDeliverableLabel(e.target.value)}
                        placeholder="Milestone Reference"
                        className="w-full h-11 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 text-xs text-zinc-200 outline-none focus:border-zinc-600"
                      />
                      <input
                        value={deliverableLink}
                        onChange={(e) => setDeliverableLink(e.target.value)}
                        placeholder="Link to Artifact (GitHub, Figma, etc)"
                        className="w-full h-11 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 text-xs text-zinc-200 outline-none focus:border-zinc-600"
                      />
                      <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/30 text-xs font-bold text-zinc-500 hover:bg-zinc-950/50">
                        <FileUp className="h-4 w-4" />
                        <span>{deliverableFile ? deliverableFile.name : "Attach Evidence"}</span>
                        <input type="file" className="hidden" onChange={(e) => setDeliverableFile(e.target.files?.[0] ?? null)} />
                      </label>
                      <button
                        type="submit"
                        disabled={busyAction === "deliverable"}
                        className="w-full h-11 rounded-xl bg-zinc-100 text-zinc-950 text-xs font-black transition-all hover:bg-white"
                      >
                        {busyAction === "deliverable" ? "Syncing..." : "Submit for Approval"}
                      </button>
                    </form>
                  )}

                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {deliverables.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-600 font-bold">
                        Awaiting first submission.
                      </div>
                    ) : deliverables.map((d) => (
                      <article key={d.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-bold text-zinc-600 uppercase">Milestone {d.milestone_index}</span>
                            <h4 className="mt-1 text-sm font-bold text-zinc-200">{d.label}</h4>
                          </div>
                          <time className="text-[10px] text-zinc-600">{formatDate(d.created_at)}</time>
                        </div>
                        <a href={d.url} target="_blank" className="mt-4 inline-block text-[11px] font-black text-emerald-500 hover:text-emerald-400 uppercase tracking-tighter">
                          View Artifact →
                        </a>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-8">
            {/* Wallet Info */}
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-6">
                <Wallet className="h-5 w-5 text-emerald-500" />
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Consensus Actor</h3>
              </div>
              <div className="rounded-2xl bg-zinc-950/50 border border-zinc-800 p-4">
                <p className="text-[11px] font-mono text-zinc-400 break-all leading-relaxed">
                  {viewerAddress ?? "No Entity Connected"}
                </p>
              </div>
              {!viewerAddress && (
                <button
                  onClick={() => void ensureViewerAddress()}
                  className="mt-6 w-full h-11 rounded-xl border border-zinc-700 text-xs font-bold text-white hover:bg-zinc-800 transition-all"
                >
                  Authorize Wallet
                </button>
              )}
            </section>

            {/* Reputation Info */}
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-xl">
              <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6">Trust Metrics</h3>
              <div className="space-y-4">
                <div className="rounded-2xl bg-zinc-950/50 border border-zinc-800 p-4">
                  <span className="text-[10px] font-bold text-zinc-600 uppercase">Client Trust</span>
                  <div className="mt-2 flex items-center justify-between">
                    <Stars value={clientReputation?.starRating ?? 0} />
                    <span className="text-xs font-bold text-white">{clientReputation?.starRating.toFixed(1) ?? "0.0"}</span>
                  </div>
                </div>

                {job.freelancer_address && (
                  <div className="rounded-2xl bg-zinc-950/50 border border-zinc-800 p-4">
                    <span className="text-[10px] font-bold text-zinc-600 uppercase">Freelancer Trust</span>
                    <div className="mt-2 flex items-center justify-between">
                      <Stars value={freelancerReputation?.starRating ?? 0} />
                      <span className="text-xs font-bold text-white">{freelancerReputation?.starRating.toFixed(1) ?? "0.0"}</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Action Panel */}
            {job.status === "awaiting_funding" && (
              <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.03] p-6 backdrop-blur-xl shadow-[0_0_40px_-15px_rgba(16,185,129,0.2)]">
                <h3 className="text-sm font-black text-emerald-500 uppercase tracking-widest">Escrow Injection Required</h3>
                <p className="mt-4 text-xs leading-relaxed text-zinc-400">
                  The service provider is locked. Deposit funds to initiate active smart contract execution.
                </p>
                <Link
                  href={`/jobs/${id}/fund`}
                  className="mt-6 flex h-12 items-center justify-center rounded-xl bg-emerald-500 text-zinc-950 text-sm font-black transition-all hover:bg-emerald-400"
                >
                  Open Funding Review
                </Link>
              </section>
            )}

            {job.status !== "open" && job.status !== "awaiting_funding" && (
              <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Admin Control</h3>
                <div className="mt-6 space-y-4">
                  <button
                    onClick={handleReleaseFunds}
                    disabled={workflowLocked || job.status !== "deliverable_submitted" || !nextMilestone || busyAction === "release"}
                    className="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-zinc-950 text-sm font-bold disabled:opacity-20 transition-all"
                  >
                    {busyAction === "release" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                    Approve &amp; Settle
                  </button>
                  <button
                    onClick={handleOpenDispute}
                    disabled={workflowLocked || busyAction === "dispute"}
                    className="w-full h-12 flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 text-white text-sm font-bold disabled:opacity-20 hover:bg-zinc-800 transition-all"
                  >
                    {busyAction === "dispute" ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Gavel className="h-5 w-5" />}
                    Flag Dispute
                  </button>
                </div>
              </section>
            )}

            {/* Stats Pulse */}
            <section className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-xl">
              <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6">Activity Pulse</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/50">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase">Target Milestone</span>
                  <span className="text-[11px] font-bold text-white">
                    {nextMilestone ? `#${nextMilestone.index}` : "All Cleared"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase">Last Sync</span>
                  <span className="text-[11px] font-bold text-white">{formatDate(job.updated_at)}</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </SiteShell>
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}
