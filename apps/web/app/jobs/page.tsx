"use client";

import { useEffect, useState } from "react";
import { api, Job } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { Briefcase, DollarSign, Calendar, ArrowRight, Layers, User } from "lucide-react";
import BidModal from "@/components/BidModal";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const data = await api.jobs.list();
        setJobs(data);
      } catch (err) {
        console.error("Failed to fetch jobs:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchJobs();
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-8 py-12 space-y-12">
      <div className="space-y-4">
        <h1 className="text-6xl font-black tracking-tighter uppercase">Marketplace</h1>
        <div className="flex items-center gap-4 text-muted-foreground font-bold text-sm tracking-widest uppercase">
            <span>EXPLORE OPEN GIGS</span>
            <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {[1, 2, 3].map(i => (
              <div key={i} className="h-72 glass rounded-3xl animate-pulse" />
            ))}
          </motion.div>
        ) : (
          <motion.div 
            key="content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          >
            {jobs.map((job, idx) => (
              <motion.div 
                key={job.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => setSelectedJob(job)}
                className="group relative glass p-8 rounded-3xl hover:bg-white/5 transition-all cursor-pointer border border-transparent hover:border-primary/30 shadow-xl overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">
                    <ArrowRight className="transform -rotate-45 group-hover:rotate-0 transition-transform" />
                </div>

                <div className="space-y-6">
                    <div className="flex gap-2">
                        <span className="bg-primary/20 text-primary text-[10px] font-black px-2 py-1 rounded-md tracking-widest uppercase">STAREX</span>
                        <span className="bg-white/10 text-white/50 text-[10px] font-black px-2 py-1 rounded-md tracking-widest uppercase">{job.status}</span>
                    </div>

                    <h2 className="text-2xl font-bold line-clamp-2 leading-tight group-hover:text-primary transition-colors">{job.title}</h2>
                    
                    <p className="text-muted-foreground text-sm line-clamp-3 leading-relaxed">
                        {job.description}
                    </p>

                    <div className="pt-4 border-t border-border flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">BUDGET</span>
                            <span className="text-lg font-bold flex items-center gap-1 text-white"><DollarSign size={14} /> {job.budget_usdc} USDC</span>
                        </div>
                        <div className="flex flex-col text-right">
                            <span className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">CLIENT</span>
                            <span className="text-sm font-bold opacity-60 flex items-center gap-1 justify-end truncate w-24"><User size={12} /> {job.client_address.slice(0, 4)}...{job.client_address.slice(-4)}</span>
                        </div>
                    </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {selectedJob && (
        <BidModal 
          job={selectedJob} 
          onClose={() => setSelectedJob(null)} 
          onSuccess={() => { /* Alert/Toast SUCCESS */ }}
        />
      )}
    </main>
  );
}
