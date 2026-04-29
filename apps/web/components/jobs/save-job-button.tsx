"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, LoaderCircle, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import * as Popover from "@radix-ui/react-popover";
import { api } from "@/lib/api";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { cn } from "@/lib/utils";

const saveJobSchema = z.object({
  note: z.string().max(255, "Note must be under 255 characters").optional(),
});

export function SaveJobButton({ jobId }: { jobId: string }) {
  const { address } = useWalletSession();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: savedJobs = [], isLoading: isLoadingSaved } = useQuery({
    queryKey: ["savedJobs", address],
    queryFn: () => (address ? api.users.savedJobs(address) : Promise.resolve([])),
    enabled: !!address,
  });

  const isSaved = savedJobs.some((job) => job.job_id === jobId);

  const saveMutation = useMutation({
    mutationFn: (body: { note?: string }) => {
      if (!address) throw new Error("Wallet not connected");
      return api.jobs.save(jobId, address, body);
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["savedJobs", address] });
      const previousSavedJobs = queryClient.getQueryData(["savedJobs", address]);
      
      queryClient.setQueryData(["savedJobs", address], (old: Array<{id: string, job_id: string, user_address: string, note?: string, created_at: string}> | undefined) => [
        ...(old || []),
        { id: "optimistic", job_id: jobId, user_address: address, note: variables.note, created_at: new Date().toISOString() }
      ]);
      return { previousSavedJobs };
    },
    onError: (err, variables, context) => {
      if (context?.previousSavedJobs) {
        queryClient.setQueryData(["savedJobs", address], context.previousSavedJobs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["savedJobs", address] });
    },
  });

  const unsaveMutation = useMutation({
    mutationFn: () => {
      if (!address) throw new Error("Wallet not connected");
      return api.jobs.unsave(jobId, address);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["savedJobs", address] });
      const previousSavedJobs = queryClient.getQueryData(["savedJobs", address]);
      
      queryClient.setQueryData(["savedJobs", address], (old: Array<{id: string, job_id: string, user_address: string, note?: string, created_at: string}> | undefined) => 
        (old || []).filter((j) => j.job_id !== jobId)
      );
      return { previousSavedJobs };
    },
    onError: (err, variables, context) => {
      if (context?.previousSavedJobs) {
        queryClient.setQueryData(["savedJobs", address], context.previousSavedJobs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["savedJobs", address] });
    },
  });

  const handleToggle = () => {
    if (!address) return;
    if (isSaved) {
      unsaveMutation.mutate();
    } else {
      setIsOpen(true);
    }
  };

  const handleSave = () => {
    try {
      const parsed = saveJobSchema.parse({ note });
      saveMutation.mutate(parsed, {
        onSuccess: () => {
          setIsOpen(false);
          setNote("");
          setValidationError(null);
        }
      });
    } catch (e) {
      if (e instanceof z.ZodError) {
        setValidationError(e.issues[0].message);
      }
    }
  };

  const isLoading = isLoadingSaved || saveMutation.isPending || unsaveMutation.isPending;

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          onClick={handleToggle}
          disabled={isLoading || !address}
          className={cn(
            "group inline-flex items-center gap-2 rounded-[12px] border px-4 py-2 text-sm font-semibold shadow-sm backdrop-blur-md transition-all duration-150 active:scale-95 disabled:opacity-50",
            isSaved
              ? "border-emerald-500/20 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-slate-200/50 bg-white/60 text-slate-700 hover:bg-slate-50/80"
          )}
        >
          {isLoading ? (
            <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />
          ) : isSaved ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 transition-transform group-hover:scale-110" />
          ) : (
            <Bookmark className="h-4 w-4 text-slate-400 transition-transform group-hover:scale-110" />
          )}
          {isSaved ? "Saved" : "Save Job"}
        </button>
      </Popover.Trigger>
      
      {!isSaved && (
        <Popover.Portal>
          <Popover.Content
            className="z-50 w-72 rounded-[12px] border border-slate-200/50 bg-white/80 p-4 shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
            sideOffset={8}
            align="end"
          >
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Save this job</h4>
                <p className="text-xs text-slate-500">Add an optional note for why you saved this.</p>
              </div>
              
              <div className="space-y-1">
                <textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="E.g., Great match for my skills..."
                  className={cn(
                    "min-h-[80px] w-full rounded-lg border bg-white/50 px-3 py-2 text-sm text-slate-900 outline-none transition-colors",
                    validationError ? "border-red-400 focus:border-red-500" : "border-slate-200 focus:border-slate-400"
                  )}
                />
                {validationError && (
                  <p className="text-xs text-red-500">{validationError}</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setNote("");
                    setValidationError(null);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  {saveMutation.isPending && <LoaderCircle className="h-3 w-3 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
            <Popover.Arrow className="fill-white/80" />
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}
