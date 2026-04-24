"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@/lib/query-client";
import { LoaderCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  buildBidProposalPayload,
  submitBidSchema,
  type SubmitBidInput,
} from "@/lib/validation/submit-bid";
import { getConnectedWalletAddress } from "@/lib/stellar";

interface SubmitBidModalProps {
  jobId: string;
  onSubmitted: () => Promise<void> | void;
}

const initialValues: SubmitBidInput = {
  proposal: "",
  timelineDays: 14,
  milestoneSummary: "",
};

export function SubmitBidModal({ jobId, onSubmitted }: SubmitBidModalProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<SubmitBidInput>(initialValues);
  const [touched, setTouched] = useState<Record<keyof SubmitBidInput, boolean>>({
    proposal: false,
    timelineDays: false,
    milestoneSummary: false,
  });

  const walletQuery = useQuery({
    queryKey: ["connected-wallet"],
    queryFn: () => getConnectedWalletAddress(),
    staleTime: 30_000,
  });

  const validationResult = useMemo(() => submitBidSchema.safeParse(values), [values]);
  const fieldErrors = useMemo(() => {
    if (validationResult.success) {
      return {} as Record<keyof SubmitBidInput, string | undefined>;
    }

    return {
      proposal: validationResult.error.flatten().fieldErrors.proposal?.[0],
      timelineDays: validationResult.error.flatten().fieldErrors.timelineDays?.[0],
      milestoneSummary:
        validationResult.error.flatten().fieldErrors.milestoneSummary?.[0],
    } as Record<keyof SubmitBidInput, string | undefined>;
  }, [validationResult]);

  const submitMutation = useMutation({
    mutationFn: async (input: SubmitBidInput) => {
      const freelancerAddress = walletQuery.data ?? "GD...FREELANCER";
      await api.bids.create(jobId, {
        freelancer_address: freelancerAddress,
        proposal: buildBidProposalPayload(input),
      });
    },
    onSuccess: async () => {
      setValues(initialValues);
      setTouched({ proposal: false, timelineDays: false, milestoneSummary: false });
      setOpen(false);
      await onSubmitted();
    },
  });

  const canSubmit = validationResult.success && !submitMutation.isPending;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ proposal: true, timelineDays: true, milestoneSummary: true });

    if (!validationResult.success) {
      return;
    }

    submitMutation.mutate(validationResult.data);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-zinc-950 transition duration-150 hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:scale-[0.99]"
      >
        Submit Bid
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-zinc-950/70 p-4 backdrop-blur-sm sm:items-center sm:justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-bid-title"
            aria-describedby="submit-bid-description"
            className="w-full max-w-2xl rounded-xl border border-zinc-700/70 bg-zinc-950/90 p-4 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="submit-bid-title" className="text-xl font-semibold text-zinc-50">
                  Submit Bid
                </h2>
                <p id="submit-bid-description" className="mt-1 text-sm text-zinc-300">
                  Craft a clear proposal with timeline and milestone plan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-zinc-400 transition duration-150 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100"
                aria-label="Close submit bid modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm text-zinc-200" htmlFor="proposal-input">
                Proposal
                <textarea
                  id="proposal-input"
                  value={values.proposal}
                  onBlur={() => setTouched((prev) => ({ ...prev, proposal: true }))}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, proposal: event.target.value }))
                  }
                  placeholder="Explain your approach, relevant work, and risk mitigation strategy."
                  className="min-h-36 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-zinc-50 outline-none transition duration-150 placeholder:text-zinc-500 focus:border-emerald-400"
                />
                {touched.proposal && fieldErrors.proposal ? (
                  <span className="text-xs text-amber-400">{fieldErrors.proposal}</span>
                ) : null}
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-zinc-200" htmlFor="timeline-input">
                  Timeline (days)
                  <input
                    id="timeline-input"
                    type="number"
                    min={1}
                    max={365}
                    value={values.timelineDays}
                    onBlur={() => setTouched((prev) => ({ ...prev, timelineDays: true }))}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        timelineDays: Number(event.target.value),
                      }))
                    }
                    className="h-11 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 text-zinc-50 outline-none transition duration-150 focus:border-emerald-400"
                  />
                  {touched.timelineDays && fieldErrors.timelineDays ? (
                    <span className="text-xs text-amber-400">{fieldErrors.timelineDays}</span>
                  ) : null}
                </label>

                <label className="grid gap-2 text-sm text-zinc-200" htmlFor="wallet-input">
                  Freelancer wallet
                  <input
                    id="wallet-input"
                    readOnly
                    value={walletQuery.data ?? "Connect wallet to auto-fill"}
                    className="h-11 rounded-xl border border-zinc-700 bg-zinc-900/40 px-3 text-zinc-400"
                  />
                </label>
              </div>

              <label className="grid gap-2 text-sm text-zinc-200" htmlFor="milestone-summary-input">
                Milestone summary
                <input
                  id="milestone-summary-input"
                  value={values.milestoneSummary}
                  onBlur={() => setTouched((prev) => ({ ...prev, milestoneSummary: true }))}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      milestoneSummary: event.target.value,
                    }))
                  }
                  placeholder="Example: UI draft (day 5), integration (day 10), QA + handoff (day 14)."
                  className="h-11 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 text-zinc-50 outline-none transition duration-150 placeholder:text-zinc-500 focus:border-emerald-400"
                />
                {touched.milestoneSummary && fieldErrors.milestoneSummary ? (
                  <span className="text-xs text-amber-400">{fieldErrors.milestoneSummary}</span>
                ) : null}
              </label>

              {submitMutation.error ? (
                <p className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                  {submitMutation.error.message || "Failed to submit bid."}
                </p>
              ) : null}

              <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-11 rounded-xl border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 transition duration-150 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 transition duration-150 hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-emerald-800 disabled:text-zinc-300"
                >
                  {submitMutation.isPending ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Confirm Bid"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
