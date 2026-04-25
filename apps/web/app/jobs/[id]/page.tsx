"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { 
  Gavel, 
  ShieldAlert, 
  FileUp, 
  CheckCircle2,
  ChevronRight,
  LoaderCircle
} from "lucide-react";
import { useLiveJobWorkspace } from "@/hooks/use-live-job-workspace";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { JobHeader } from "@/components/jobs/job-header";
import { MilestoneLedger } from "@/components/jobs/milestone-ledger";
import { JobSidebar } from "@/components/jobs/job-sidebar";
import { GlassCard } from "@/components/ui/glass-card";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { BidList } from "@/components/jobs/bid-list";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { SubmitBidErrorBoundary } from "@/components/jobs/submit-bid-error-boundary";
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { SiteShell } from "@/components/site-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Stars } from "@/components/stars";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { useLiveJobWorkspace } from "@/hooks/use-live-job-workspace";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const workspace = useLiveJobWorkspace(id);
  const { address: viewerAddress } = useWalletStore();
  
  const [deliverableLabel, setDeliverableLabel] = useState("");
  const [deliverableLink, setDeliverableLink] = useState("");
  const [isSubmittingEvidence, setIsSubmittingEvidence] = useState(false);

  if (workspace.loading) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8">
        <JobDetailsSkeleton />
      </div>
    );
  }

  const job = workspace.job;
  if (!job) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-8 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-rose-500" />
        <h1 className="text-2xl font-bold text-white">Workspace Unavailable</h1>
        <p className="mt-2 text-zinc-400">We couldn&apos;t load that job.</p>
        <Link href="/jobs" className="mt-6 text-indigo-400 hover:underline">Return to Marketplace</Link>
      </div>
    );
  }

  const workflowLocked = job.status === "disputed" || workspace.dispute !== null;
  const isFreelancer = viewerAddress === job.freelancer_address;

  async function onDeliverableSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!deliverableLabel || !viewerAddress) return;

    setIsSubmittingEvidence(true);
    try {
      await api.jobs.deliverables.submit(id, {
        submitted_by: viewerAddress,
        label: deliverableLabel,
        kind: "link",
        url: deliverableLink,
      });
      toast.success("Evidence added successfully");
      setDeliverableLabel("");
      setDeliverableLink("");
      workspace.refresh();
    } catch {
      toast.error("Failed to add evidence");
    } finally {
      setIsSubmittingEvidence(false);
    }
  }

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

        <JobHeader job={job} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-8">
            {workflowLocked && (
              <GlassCard className="border-rose-500/20 bg-rose-500/5 text-rose-200">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
                    <Gavel className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold">Dispute Center Active</h3>
                    <p className="mt-1 text-sm text-rose-200/70">
                      Standard operations are frozen until an Agent Judge resolves this case.
                    </p>
                    <Link href={`/jobs/${id}/dispute${workspace.dispute ? `?disputeId=${workspace.dispute.id}` : ""}`} className="mt-4 inline-flex font-bold text-rose-400 hover:underline">
                      Enter Dispute Chamber
                    </Link>
                  </div>
                </div>
              </GlassCard>
            )}

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
                        onChainJobId={BigInt(job.on_chain_job_id ?? 0)}
                        onSubmitted={async () => { workspace.refresh(); }}
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
                    isClientOwner={viewerAddress === job.client_address}
                    jobStatus={job.status}
                    onAccept={async () => { workspace.refresh(); }}
                  />
                </section>
              </div>
            ) : (
              <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
                <div className="space-y-8">
                  <MilestoneLedger milestones={workspace.milestones} />
                  
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1 text-white">
                      <FileUp className="h-4 w-4 text-emerald-400" />
                      <h3 className="text-lg font-semibold">Evidence Lockbox</h3>
                    </div>
                    
                    <div className="grid gap-4 sm:grid-cols-2">
                      {workspace.deliverables.map((d) => (
                        <GlassCard key={d.id} className="group relative overflow-hidden p-5">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Phase {d.milestone_index}</span>
                              <h4 className="font-semibold text-zinc-200">{d.label}</h4>
                            </div>
                            <div className="rounded-md bg-zinc-950 p-2 border border-zinc-800">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
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
                          <a href={d.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 py-2 text-xs font-bold text-zinc-300 transition hover:border-zinc-700 hover:text-white">
                            View Submission
                          </a>
                        </GlassCard>
                      ))}

                      {isFreelancer && !workflowLocked && (
                        <GlassCard className="border-dashed border-zinc-700 bg-transparent hover:bg-zinc-900/20">
                          <form onSubmit={onDeliverableSubmit} className="space-y-3">
                            <input 
                              value={deliverableLabel}
                              onChange={(e) => setDeliverableLabel(e.target.value)}
                              placeholder="Milestone Title" 
                              className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none" 
                            />
                            <input 
                              value={deliverableLink}
                              onChange={(e) => setDeliverableLink(e.target.value)}
                              placeholder="Submission Link" 
                              className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-600 outline-none" 
                            />
                            <button 
                              type="submit" 
                              disabled={isSubmittingEvidence}
                              className="mt-2 flex w-full items-center justify-center rounded-lg bg-zinc-100 py-2 text-xs font-bold text-black hover:bg-white disabled:opacity-50"
                            >
                              {isSubmittingEvidence ? <LoaderCircle className="h-3 w-4 animate-spin" /> : "Add Evidence"}
                            </button>
                          </form>
                        </GlassCard>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          <JobSidebar 
            viewerAddress={viewerAddress} 
            clientReputation={workspace.clientReputation} 
            freelancerReputation={workspace.freelancerReputation} 
          />
        </div>
      </main>
    </div>
  );
}
