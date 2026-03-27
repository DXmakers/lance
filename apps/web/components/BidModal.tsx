"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { connectWallet, signTransaction } from "@/lib/stellar";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Send, X, FileText, Upload, DollarSign } from "lucide-react";
import { useState } from "react";

const bidSchema = z.object({
  proposal: z.string().min(50, "Cover letter must be at least 50 characters"),
});

type BidFormData = z.infer<typeof bidSchema>;

interface BidModalProps {
  job: { id: string; title: string; budget_usdc: number };
  onClose: () => void;
  onSuccess: () => void;
}

export default function BidModal({ job, onClose, onSuccess }: BidModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<BidFormData>({
    resolver: zodResolver(bidSchema),
  });

  const onSubmit = async (data: BidFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Connect Wallet
      const address = await connectWallet();
      
      // 2. Upload cover letter to IPFS
      const formData = new FormData();
      formData.append("proposal", data.proposal);
      const { cid } = await api.ipfs.upload(formData);

      // 3. Create Bid in Backend DB
      await api.bids.create(job.id, {
        freelancer_address: address,
        proposal: data.proposal, // Usually we store local copy and hash
      });

      // 4. Contract call submit_bid (Mocked)
      console.log("Proposal CID for Soroban:", cid);
      
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to submit bid");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass w-full max-w-2xl overflow-hidden rounded-3xl shadow-2xl relative"
      >
        <button onClick={onClose} className="absolute top-6 right-6 text-muted-foreground hover:text-white transition-colors">
          <X size={24} />
        </button>

        <div className="p-8 md:p-12 space-y-8">
            <div className="space-y-2">
                <span className="text-primary font-bold text-sm tracking-widest uppercase">SUBMITTING PROPOSAL</span>
                <h2 className="text-3xl font-black">{job.title}</h2>
                <div className="flex items-center gap-4 text-sm font-bold opacity-60">
                    <span className="flex items-center gap-1"><DollarSign size={14} /> {job.budget_usdc} USDC</span>
                </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                        <FileText size={16} /> Cover Letter
                    </label>
                    <textarea 
                      {...register("proposal")}
                      placeholder="Explain your expertise and how you'll tackle this project..."
                      rows={8}
                      className="w-full bg-black/40 border border-border focus:border-primary p-4 rounded-xl outline-none transition-all resize-none shadow-inner"
                    />
                    {errors.proposal && <p className="text-red-400 text-sm mt-1">{errors.proposal.message}</p>}
                </div>

                {error && <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-xl text-sm">{error}</div>}

                <div className="flex gap-4">
                    <button type="button" onClick={onClose} className="flex-1 py-4 font-bold border border-border hover:bg-white/5 rounded-2xl transition-all">Cancel</button>
                    <button 
                      disabled={isLoading}
                      className="flex-[2] bg-primary hover:bg-primary/80 disabled:opacity-50 text-white py-4 rounded-2xl font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2 transition-all"
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <><Send size={18} /> Submit Application</>}
                    </button>
                </div>
                <p className="text-[10px] text-center text-muted-foreground uppercase tracking-tighter">Blockchain transaction will be triggered upon submission</p>
            </form>
        </div>
      </motion.div>
    </div>
  );
}
