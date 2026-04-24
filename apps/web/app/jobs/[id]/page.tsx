"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Gavel, 
  LoaderCircle, 
  ShieldAlert, 
  FileUp, 
  MessageSquare,
  CheckCircle2,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";

import { useJobQuery } from "@/hooks/use-job-query";
import { useJobActions } from "@/hooks/use-job-actions"; // I'll create this or just use the mutations from useJobQuery
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { connectWallet } from "@/lib/stellar";
import { BidFormSchema, BidFormData, DeliverableFormSchema, DeliverableFormData } from "@/lib/schemas/job-schemas";
import { api } from "@/lib/api";

import { JobHeader } from "@/components/jobs/job-header";
import { MilestoneLedger } from "@/components/jobs/milestone-ledger";
import { JobSidebar } from "@/components/jobs/job-sidebar";
import { GlassCard } from "@/components/ui/glass-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { JobDetailsSkeleton } from "@/components/ui/skeleton";
import { shortenAddress, formatDateTime } from "@/lib/format";
import Link from "next/link";

export default function JobDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { address: viewerAddress } = useWalletStore();
  const { data, isLoading, error, mutations } = useJobQuery(id);

  const bidForm = useForm<BidFormData>({
    resolver: zodResolver(BidFormSchema),
    defaultValues: { proposal: "" },
  });

  const deliverableForm = useForm<DeliverableFormData>({
    resolver: zodResolver(DeliverableFormSchema),
    defaultValues: { label: "", url: "" },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8">
        <JobDetailsSkeleton />
      </div>
    );
  }

  if (error || !data?.job) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-8 text-center">
        <ShieldAlert className="mb-4 h-12 w-12 text-rose-500" />
        <h1 className="text-2xl font-bold text-white">Workspace Unavailable</h1>
        <p className="mt-2 text-zinc-400">{error?.message || "We couldn't load that job."}</p>
        <Link href="/jobs" className="mt-6 text-indigo-400 hover:underline">Return to Marketplace</Link>
      </div>
    );
  }

  const { job, bids, milestones, deliverables, dispute, clientReputation, freelancerReputation } = data;
  const nextMilestone = milestones.find((m) => m.status === "pending");
  const isClient = viewerAddress === job.client_address;
  const isFreelancer = viewerAddress === job.freelancer_address;
  const workflowLocked = job.status === "disputed" || dispute !== null;

  async function onBidSubmit(values: BidFormData) {
    try {
      let currentAddress = viewerAddress;
      if (!currentAddress) {
        currentAddress = await connectWallet();
      }
      await mutations.createBid.mutateAsync({
        freelancer_address: currentAddress,
        proposal: values.proposal,
      });
      toast.success("Proposal submitted successfully");
      bidForm.reset();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit proposal");
    }
  }

  async function onDeliverableSubmit(values: DeliverableFormData) {
    try {
      let url = values.url || "";
      let fileHash: string | undefined;
      let kind = values.url ? "link" : "file";

      if (values.file) {
        const upload = await api.uploads.pin(values.file);
        url = `ipfs://${upload.cid}`;
        fileHash = upload.cid;
        kind = "file";
      }

      await mutations.submitDeliverable.mutateAsync({
        submitted_by: viewerAddress!,
        label: values.label,
        kind,
        url,
        file_hash: fileHash,
      });
      toast.success("Milestone evidence submitted");
      deliverableForm.reset();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit deliverable");
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
                    <Link href={`/jobs/${id}/dispute${dispute ? `?disputeId=${dispute.id}` : ""}`} className="mt-4 inline-flex font-bold text-rose-400 hover:underline">
                      Enter Dispute Chamber
                    </Link>
                  </div>
                </div>
              </GlassCard>
            )}

            {job.status === "open" && (
              <div className="grid gap-8 lg:grid-cols-2">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <MessageSquare className="h-4 w-4 text-indigo-400" />
                    <h3 className="text-lg font-semibold text-white">Your Proposal</h3>
                  </div>
                  <GlassCard>
                    <form onSubmit={bidForm.handleSubmit(onBidSubmit)} className="space-y-4">
                      <div className="space-y-2">
                        <textarea
                          {...bidForm.register("proposal")}
                          className="min-h-[200px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
                          placeholder="Outline your strategy, relevant experience, and timeline..."
                        />
                        {bidForm.formState.errors.proposal && (
                          <p className="text-xs text-rose-500">{bidForm.formState.errors.proposal.message}</p>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={mutations.createBid.isPending}
                        className="flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {mutations.createBid.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Submit Proposal"}
                      </button>
                    </form>
                  </GlassCard>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge status="open" className="bg-zinc-800 text-zinc-400 border-zinc-700" />
                      <h3 className="text-lg font-semibold text-white">Active Bids</h3>
                    </div>
                    <span className="text-xs text-zinc-500 font-mono">{bids.length}</span>
                  </div>
                  <div className="space-y-3">
                    {bids.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 py-12 text-zinc-600">
                        <p>No bids yet. Be the first!</p>
                      </div>
                    ) : (
                      bids.map((bid) => (
                        <GlassCard key={bid.id} className="p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-mono text-zinc-400">{shortenAddress(bid.freelancer_address)}</span>
                            <span className="text-[10px] text-zinc-600 font-bold uppercase">{formatDateTime(bid.created_at)}</span>
                          </div>
                          <p className="mt-3 text-sm text-zinc-300 line-clamp-3 leading-relaxed">{bid.proposal}</p>
                          {isClient && (
                            <button
                              onClick={() => mutations.acceptBid.mutate({ bidId: bid.id, client_address: job.client_address })}
                              disabled={mutations.acceptBid.isPending}
                              className="mt-4 flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-zinc-200 disabled:opacity-50"
                            >
                              {mutations.acceptBid.isPending ? "Accepting..." : "Accept Bid"}
                            </button>
                          )}
                        </GlassCard>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}

            {job.status !== "open" && (
              <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
                <div className="space-y-8">
                  <MilestoneLedger milestones={milestones} />
                  
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 px-1 text-white">
                      <FileUp className="h-4 w-4 text-emerald-400" />
                      <h3 className="text-lg font-semibold">Evidence Lockbox</h3>
                    </div>
                    
                    <div className="grid gap-4 sm:grid-cols-2">
                      {deliverables.map((d) => (
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
                          <form onSubmit={deliverableForm.handleSubmit(onDeliverableSubmit)} className="space-y-3">
                            <input {...deliverableForm.register("label")} placeholder="Milestone Title" className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none" />
                            <input {...deliverableForm.register("url")} placeholder="Submission Link" className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-600 outline-none" />
                            <button type="submit" className="mt-2 w-full rounded-lg bg-zinc-100 py-2 text-xs font-bold text-black hover:bg-white">
                              Add Evidence
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
            clientReputation={clientReputation} 
            freelancerReputation={freelancerReputation} 
          />
        </div>
      </main>
    </div>
  );
}
