"use client";

import { useJobBoard } from "@/hooks/use-job-board";
import { formatUsdc } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { 
  PlusCircle, 
  Users, 
  Briefcase, 
  ShieldCheck, 
  ArrowRight,
  TrendingUp,
  Clock,
  CheckCircle2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import Link from "next/link";
import { ActivityLogList } from "@/components/activity-log";

export function ClientDashboard() {
  const { jobs, loading } = useJobBoard();

  // In a real app, we'd filter by user.address. 
  // For the demo, we'll show some "Client" specific metrics based on the mock data.
  const activeJobs = jobs.filter(j => j.status === "open").slice(0, 5);
  const totalEscrow = activeJobs.reduce((acc, j) => acc + j.budget_usdc, 0);

  const stats = [
    { label: "Active Jobs", value: "12", icon: Briefcase, color: "text-blue-500" },
    { label: "Escrow Volume", value: formatUsdc(totalEscrow), icon: ShieldCheck, color: "text-emerald-500" },
    { label: "Pending Bids", value: "48", icon: Users, color: "text-amber-500" },
    { label: "Completion Rate", value: "98%", icon: TrendingUp, color: "text-purple-500" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border/60 bg-background/50 backdrop-blur-sm overflow-hidden group hover:border-primary/30 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">{stat.value}</div>
              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <span className="text-emerald-500 font-bold">+12%</span> from last cycle
              </p>
            </CardContent>
            <div className="absolute bottom-0 left-0 h-1 w-0 bg-primary/20 group-hover:w-full transition-all duration-500" />
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.45fr]">
        <Card className="border-border/60 bg-zinc-950 text-zinc-50 dark:bg-card dark:text-card-foreground">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl font-bold">Active Registry</CardTitle>
              <CardDescription className="text-zinc-400">Monitor your open briefs and milestone posture.</CardDescription>
            </div>
            <Link href="/jobs/new" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20">
              <PlusCircle className="h-4 w-4" />
              Post Job
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 w-full animate-pulse rounded-2xl bg-white/5" />
                ))
              ) : (
                activeJobs.map((job) => (
                  <div key={job.id} className="group flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4 hover:bg-white/[0.05] transition-all duration-200">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-zinc-100">{job.title}</h4>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-zinc-500">{formatUsdc(job.budget_usdc)}</span>
                          <span className="h-1 w-1 rounded-full bg-zinc-700" />
                          <span className="text-xs text-zinc-500">{job.milestones} milestones</span>
                        </div>
                      </div>
                    </div>
                    <Link href={`/jobs/${job.id}`} className="p-2 rounded-full hover:bg-white/10 transition-colors text-zinc-500 hover:text-zinc-100">
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </div>
                ))
              )}
            </div>
            <Button variant="ghost" className="w-full mt-6 rounded-xl border border-white/5 text-zinc-400 hover:text-zinc-100 hover:bg-white/5">
              View all active jobs
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60 bg-background/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Recent Activity</CardTitle>
              <CardDescription>Real-time updates</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              <ActivityLogList />
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5 relative overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Compliance Status</span>
              </div>
              <CardTitle className="text-xl">Fully Verified</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your account is currently aligned with all on-chain reputation requirements.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
