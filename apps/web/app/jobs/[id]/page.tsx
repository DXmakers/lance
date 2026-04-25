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
import { SubmitBidModal } from "@/components/jobs/submit-bid-modal";
import { SubmitBidErrorBoundary } from "@/components/jobs/submit-bid-error-boundary";
import Link from "next/link";
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
    <div className="min-h-screen bg-zinc-950 text-zinc-200 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link href="/jobs" className="group inline-flex items-center gap-1 text-sm text-zinc-500 transition hover:text-zinc-300">
            <ChevronRight className="h-4 w-4 rotate-180 transition group-hover:-translate-x-0.5" />
            Back to Marketplace
          </Link>
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
