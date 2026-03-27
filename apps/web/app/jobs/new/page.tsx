"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { connectWallet, signTransaction } from "@/lib/stellar";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Rocket, FileText, DollarSign, ListOrdered, CheckCircle2, ChevronRight, ChevronLeft, Upload } from "lucide-react";

// --- Validation ---
const jobSchema = z.object({
  title: z.string().min(10, "Title must be at least 10 characters"),
  description: z.string().min(50, "Description must be at least 50 characters"),
  budget: z.number().min(5, "Minimum budget is 5 USDC"),
  milestones: z.number().int().min(1).max(10),
  attachments: z.any().optional(),
});

type JobFormData = z.infer<typeof jobSchema>;

export default function NewJobPage() {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      budget: 100,
      milestones: 1,
    }
  });

  const onSubmit = async (data: JobFormData) => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Connect Wallet
      const address = await connectWallet();
      
      // 2. Upload to IPFS via Backend
      const formData = new FormData();
      formData.append("title", data.title);
      formData.append("description", data.description);
      formData.append("budget", data.budget.toString());
      if (data.attachments?.[0]) {
        formData.append("file", data.attachments[0]);
      }
      
      const { cid } = await api.ipfs.upload(formData);
      
      // 3. Create job in Backend DB (Optimistic)
      const job = await api.jobs.create({
        title: data.title,
        description: data.description,
        budget_usdc: data.budget,
        milestones: data.milestones,
        client_address: address,
      });

      // 4. Build and Sign XDR (Mocked for now as we don't have the contract ID yet)
      // In a real scenario, this would call a helper to get a real XDR from Horizon/RPC
      console.log("CID for Soroban:", cid);
      console.log("Job ID:", job.id);
      
      // TODO: Replace with real contract call
      setError("Please wait for transaction signing...");
      
      // We simulate signing with a dummy XDR if it were a real call
      // const xdr = await getPostJobXDR(job.id, address, cid, data.budget);
      // await signTransaction(xdr);

      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass p-12 rounded-3xl max-w-lg w-full text-center space-y-6 shadow-2xl"
        >
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
            Gig Broadcasted!
          </h1>
          <p className="text-muted-foreground text-lg">
            Your job has been securely posted on-chain. Agents are now reviewing it for verification. 
            Wait for incoming bids from top-tier freelancers.
          </p>
          <button 
            onClick={() => window.location.href = "/jobs"}
            className="w-full bg-primary hover:bg-primary/80 text-white font-bold py-4 rounded-xl transition-all"
          >
            Go to Dashboard
          </button>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto space-y-12">
      <div className="space-y-4">
        <h1 className="text-5xl font-black tracking-tighter">POST A GIG</h1>
        <div className="flex gap-4">
            {[1, 2, 3].map(i => (
                <div key={i} className={`h-2 flex-1 rounded-full ${step >= i ? 'bg-primary' : 'bg-muted'}`} />
            ))}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass p-8 rounded-3xl space-y-6"
            >
              <div className="flex items-center gap-3 text-2xl font-bold">
                <FileText className="text-primary" />
                <h2>Project Definition</h2>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Title</label>
                    <input 
                      {...register("title")}
                      placeholder="e.g. Build a Soroban DEX Front-end"
                      className="w-full bg-black/40 border border-border focus:border-primary p-4 rounded-xl outline-none transition-all"
                    />
                    {errors.title && <p className="text-red-400 text-sm">{errors.title.message}</p>}
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Description</label>
                    <textarea 
                      {...register("description")}
                      placeholder="Detail the requirements, tech stack, and expectations..."
                      rows={6}
                      className="w-full bg-black/40 border border-border focus:border-primary p-4 rounded-xl outline-none transition-all resize-none"
                    />
                    {errors.description && <p className="text-red-400 text-sm">{errors.description.message}</p>}
                </div>
              </div>
              <button type="button" onClick={nextStep} className="w-full flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-white py-4 rounded-xl font-bold">
                Next Stage <ChevronRight />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass p-8 rounded-3xl space-y-6"
            >
              <div className="flex items-center gap-3 text-2xl font-bold">
                <DollarSign className="text-primary" />
                <h2>Budget & Scope</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Budget (USDC)</label>
                    <input 
                      type="number"
                      {...register("budget", { valueAsNumber: true })}
                      className="w-full bg-black/40 border border-border focus:border-primary p-4 rounded-xl outline-none transition-all"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Milestones (1-10)</label>
                    <input 
                      type="number"
                      {...register("milestones", { valueAsNumber: true })}
                      className="w-full bg-black/40 border border-border focus:border-primary p-4 rounded-xl outline-none transition-all"
                    />
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                  <button type="button" onClick={prevStep} className="flex-1 border border-border hover:bg-white/5 py-4 rounded-xl font-bold">Back</button>
                  <button type="button" onClick={nextStep} className="flex-[2] bg-secondary hover:bg-secondary/80 py-4 rounded-xl font-bold">Progress <ChevronRight className="inline" /></button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="glass p-8 rounded-3xl space-y-6"
            >
              <div className="flex items-center gap-3 text-2xl font-bold">
                <Upload className="text-primary" />
                <h2>Attachments & Verify</h2>
              </div>
              
              <div className="border-2 border-dashed border-muted rounded-3xl p-12 text-center hover:border-primary transition-colors cursor-pointer group">
                  <input type="file" {...register("attachments")} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="cursor-pointer space-y-4 block">
                    <div className="w-16 h-16 bg-muted/20 rounded-2xl flex items-center justify-center mx-auto group-hover:bg-primary/20 transition-colors">
                        <Upload className="w-8 h-8 group-hover:text-primary" />
                    </div>
                    <div>
                        <p className="text-lg font-bold">Drop files or click to upload</p>
                        <p className="text-muted-foreground text-sm">Specs, Design mockups, etc. (Max 10MB)</p>
                    </div>
                  </label>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl text-sm">
                    {error}
                </div>
              )}

              <div className="flex gap-4 pt-4">
                  <button type="button" onClick={prevStep} className="flex-1 border border-border hover:bg-white/5 py-4 rounded-xl font-bold">Back</button>
                  <button 
                    disabled={isLoading}
                    className="flex-[2] bg-primary hover:bg-primary/80 disabled:opacity-50 text-white py-4 rounded-xl font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <Loader2 className="animate-spin" /> : <Rocket size={20} />}
                    Deploy Job to Chain
                  </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </main>
  );
}
