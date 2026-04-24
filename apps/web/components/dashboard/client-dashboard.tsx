"use client";

import Link from "next/link";
import { useJobBoard } from "@/hooks/use-job-board";
import { formatUsdc } from "@/lib/format";
import { 
  PlusCircle, 
  Users, 
  Briefcase, 
  ShieldCheck, 
  ArrowRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  Star
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button as UIButton } from "@/components/ui/button";


export function ClientDashboard() {
  const { jobs, loading } = useJobBoard();

  const activeJobs = jobs.filter(j => j.status === "open").slice(0, 5);
  const totalEscrow = activeJobs.reduce((acc, j) => acc + j.budget_usdc, 0);

  const stats = [
    { label: "Active Jobs", value: activeJobs.length.toString(), icon: Briefcase, color: "text-emerald-500" },
    { label: "Escrow Volume", value: formatUsdc(totalEscrow), icon: ShieldCheck, color: "text-blue-500" },
    { label: "Talent Pool", value: "24", icon: Users, color: "text-amber-500" },
    { label: "Market Yield", value: "99.2%", icon: TrendingUp, color: "text-indigo-500" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden border-zinc-800 bg-zinc-900/40 backdrop-blur-xl shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-white tracking-tight">{stat.value}</div>
              <p className="text-[10px] text-zinc-600 mt-1 font-bold">
                <span className="text-emerald-500">OPTIMIZED</span> posture
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <Card className="border-zinc-800 bg-zinc-900/40 backdrop-blur-xl shadow-2xl rounded-[24px]">
          <CardHeader className="flex flex-row items-center justify-between p-8">
            <div className="space-y-2">
              <CardTitle className="text-2xl font-black text-white">Active Registry</CardTitle>
              <CardDescription className="text-zinc-500 font-medium">Monitor and manage your active smart contract briefs.</CardDescription>
            </div>
            <Link href="/jobs/new" className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-black text-zinc-950 hover:bg-zinc-200 transition-all shadow-lg shadow-white/5 active:scale-[0.98]">
              <PlusCircle className="h-4 w-4" />
              POST BRIEF
            </Link>
          </CardHeader>
          <CardContent className="p-8 pt-0">
            <div className="space-y-4">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 w-full animate-pulse rounded-2xl bg-zinc-800/50" />
                ))
              ) : activeJobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 py-12 text-center">
                  <Briefcase className="mx-auto h-8 w-8 text-zinc-700 mb-3" />
                  <p className="text-sm font-bold text-zinc-400">No active briefs detected</p>
                  <p className="text-xs text-zinc-600 mt-1">Initiate your first contract to begin hiring.</p>
                </div>
              ) : (
                activeJobs.map((job) => (
                  <div key={job.id} className="group flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 hover:bg-zinc-950/60 transition-all duration-150">
                    <div className="flex items-center gap-5">
                      <div className="h-10 w-10 rounded-xl bg-zinc-800/50 flex items-center justify-center text-zinc-400 border border-zinc-700/50">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-zinc-100 group-hover:text-white transition-colors">{job.title}</h4>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-tighter">{formatUsdc(job.budget_usdc)}</span>
                          <span className="h-1 w-1 rounded-full bg-zinc-800" />
                          <span className="text-[10px] font-bold text-zinc-500 uppercase">{job.milestones} MILESTONES</span>
                        </div>
                      </div>
                    </div>
                    <Link href={`/jobs/${job.id}`} className="p-2.5 rounded-xl bg-zinc-800/0 hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all">
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </div>
                ))
              )}
            </div>
            <UIButton variant="ghost" className="w-full mt-8 rounded-xl border border-zinc-800 text-zinc-500 font-bold text-xs hover:text-white hover:bg-zinc-800/50">
              EXPLORE FULL REGISTRY
            </UIButton>
          </CardContent>
        </Card>

        <div className="space-y-8">
          <Card className="border-zinc-800 bg-zinc-900/40 backdrop-blur-xl shadow-2xl rounded-[24px]">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-sm font-black text-white uppercase tracking-widest">Top Rated Talent</CardTitle>
              <CardDescription className="text-zinc-600 text-xs">Verified service providers</CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0 space-y-6">
              {[
                { name: "Tolu A.", rating: "4.9", jobs: 12, avatar: "TA" },
                { name: "Elena R.", rating: "5.0", jobs: 8, avatar: "ER" },
                { name: "Marcus V.", rating: "4.8", jobs: 15, avatar: "MV" },
              ].map((talent) => (
                <div key={talent.name} className="flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="h-9 w-9 rounded-xl bg-zinc-800 flex items-center justify-center text-[10px] font-black text-white border border-zinc-700 group-hover:border-zinc-500 transition-colors">
                      {talent.avatar}
                    </div>
                    <span className="text-sm font-bold text-zinc-200 group-hover:text-white transition-colors">{talent.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      <span className="text-xs font-black text-white">{talent.rating}</span>
                    </div>
                    <span className="text-[9px] font-bold text-zinc-600 uppercase mt-1 block">{talent.jobs} Jobs</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/[0.02] rounded-[24px] overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <ShieldCheck className="h-24 w-24 text-emerald-500" />
            </div>
            <CardHeader className="pb-2 p-6">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Security Clearance</span>
              </div>
              <CardTitle className="text-xl font-black text-white">Fully Verified</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0">
              <p className="text-xs text-zinc-400 font-medium leading-relaxed">
                Your account is currently aligned with all on-chain reputation requirements and KYC protocols.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

