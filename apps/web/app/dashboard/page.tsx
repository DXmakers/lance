"use client";

import { useEffect, useState } from "react";
import { api, Job, Bid } from "@/lib/api";
import { connectWallet } from "@/lib/stellar";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutDashboard, User, DollarSign, ArrowRight, CheckCircle, Clock, Search, ChevronDown, UserCheck, ShieldCheck } from "lucide-react";

export default function DashboardPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [bidsByJob, setBidsByJob] = useState<Record<string, Bid[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const addr = await connectWallet();
        setAddress(addr);
        const allJobs = await api.jobs.list();
        // Client only
        const clientJobs = allJobs.filter(j => j.client_address.toLowerCase() === addr.toLowerCase());
        setJobs(clientJobs);

        // Fetch bids for each job
        const bidsData: Record<string, Bid[]> = {};
        for (const job of clientJobs) {
          const jobBids = await api.bids.list(job.id);
          bidsData[job.id] = jobBids;
        }
        setBidsByJob(bidsData);
      } catch (err) {
        console.error("Dashboard error:", err);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const handleAcceptBid = async (jobId: string, bid: Bid) => {
    try {
        if (!confirm(`Accept bid from ${bid.freelancer_address}? This will initiate a Soroban contract call.`)) return;
        
        // 1. Backend update
        await api.jobs.acceptBid(jobId, bid.freelancer_address);
        
        // 2. Refetch or update locally
        setJobs(jobs.map(j => j.id === jobId ? { ...j, status: 'in_progress', freelancer_address: bid.freelancer_address } : j));
        alert("Bid accepted and job moved to 'in_progress'!");
    } catch (err: any) {
        console.error("Accept failed:", err);
        alert(err.message || "Failed to accept bid");
    }
  };

  if (!address && !isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <button onClick={() => window.location.reload()} className="glass p-8 rounded-3xl font-black text-2xl hover:scale-105 transition-all">CONNECT WALLET TO ACCESS DASHBOARD</button>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-8 py-12 space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
            <h1 className="text-6xl font-black tracking-tighter uppercase leading-none">Management</h1>
            <div className="flex items-center gap-4 text-muted-foreground font-bold text-sm tracking-widest uppercase">
                <ShieldCheck className="text-primary" />
                <span>SECURED CLIENT PORTAL</span>
                <div className="h-px w-24 bg-border" />
                <span className="opacity-40">{address?.slice(0, 6)}...{address?.slice(-6)}</span>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
            [1, 2].map(i => <div key={i} className="h-64 glass rounded-3xl animate-pulse" />)
        ) : jobs.length === 0 ? (
            <div className="glass p-20 text-center rounded-3xl space-y-4">
                <p className="text-2xl font-bold opacity-40">NO ACTIVE JOBS FOUND</p>
                <button 
                  onClick={() => window.location.href = "/jobs/new"}
                  className="bg-primary hover:bg-primary/80 px-8 py-4 rounded-2xl font-black transition-all"
                >POST YOUR FIRST GIG</button>
            </div>
        ) : (
            jobs.map(job => (
                <div key={job.id} className="glass rounded-3xl overflow-hidden border border-border group">
                    <div className="p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div className="space-y-2">
                             <div className="flex items-center gap-4">
                                <span className={`px-2 py-1 rounded-md text-[10px] font-black tracking-widest uppercase ${job.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-primary/20 text-primary'}`}>
                                    {job.status}
                                </span>
                                <span className="opacity-40 text-xs font-bold tracking-tighter">ID: {job.id.split('-')[0]}</span>
                             </div>
                             <h2 className="text-3xl font-black group-hover:text-primary transition-colors">{job.title}</h2>
                        </div>
                        <div className="flex items-center gap-8">
                             <div className="text-right">
                                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">PROPOSALS</p>
                                <p className="text-2xl font-bold">{bidsByJob[job.id]?.length || 0}</p>
                             </div>
                             <button 
                                onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                                className="bg-white/5 hover:bg-white/10 p-4 rounded-2xl transition-all"
                             >
                                <ChevronDown className={`transform transition-transform ${expandedJobId === job.id ? 'rotate-180' : ''}`} />
                             </button>
                        </div>
                    </div>

                    <AnimatePresence>
                        {expandedJobId === job.id && (
                            <motion.div 
                                initial={{ height: 0 }}
                                animate={{ height: 'auto' }}
                                exit={{ height: 0 }}
                                className="overflow-hidden bg-black/40 border-t border-border"
                            >
                                <div className="p-8 space-y-6">
                                    <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                                        <Search size={16} /> Analysis of Incoming Bids
                                    </h3>
                                    
                                    <div className="space-y-4">
                                        {bidsByJob[job.id]?.length === 0 ? (
                                            <p className="p-8 glass text-center border-dashed border-muted text-muted-foreground font-bold">WAITING FOR FREELANCERS...</p>
                                        ) : (
                                            bidsByJob[job.id]?.map(bid => (
                                                <div key={bid.id} className="glass p-6 rounded-2xl flex flex-col md:flex-row justify-between gap-6 hover:bg-white/5 transition-all">
                                                    <div className="space-y-4 flex-1">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                                                                <User size={20} />
                                                            </div>
                                                            <div>
                                                                <p className="text-lg font-bold truncate w-48">{bid.freelancer_address}</p>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-xs bg-accent/20 text-accent font-black px-1.5 py-0.5 rounded tracking-tighter">SCORE: 9.8</span>
                                                                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">REPUTATION CERTIFIED</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-muted-foreground leading-relaxed italic">"{bid.proposal}"</p>
                                                    </div>

                                                    <div className="flex items-center gap-4 justify-end">
                                                        <button className="text-sm font-bold border border-border px-6 py-3 rounded-xl hover:bg-white/5 transition-all uppercase">View profile</button>
                                                        <button 
                                                            onClick={() => handleAcceptBid(job.id, bid)}
                                                            className="text-sm font-black bg-primary hover:bg-primary/80 px-6 py-3 rounded-xl shadow-lg shadow-primary/20 transition-all flex items-center gap-2 uppercase"
                                                        >
                                                            <UserCheck size={18} /> Accept Bid
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            ))
        )}
      </div>
    </main>
  );
}
