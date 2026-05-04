/**
 * transaction-example.tsx
 *
 * Example component demonstrating how to use the Soroban transaction pipeline
 * with the useSorobanTransaction hook and TransactionPipeline UI component.
 *
 * This shows:
 *  - How to invoke a contract method with typed parameters
 *  - How to handle success/error callbacks
 *  - How to trigger UI state refresh after confirmation
 *  - How to render the visual progress tracker
 */

"use client";

import { useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TransactionPipeline } from "./transaction-pipeline";
import { useSorobanTransaction } from "@/hooks/use-soroban-transaction";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { toast } from "@/lib/toast";

const ESCROW_CONTRACT_ID = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? "";

export function TransactionExample() {
  const { address, isConnected } = useWalletSession();
  const transaction = useSorobanTransaction();

  const [jobId, setJobId] = useState("1");
  const [milestoneIndex, setMilestoneIndex] = useState("0");

  async function handleReleaseMilestone() {
    if (!address) {
      toast.error({
        title: "Wallet Not Connected",
        description: "Please connect your wallet before submitting a transaction.",
      });
      return;
    }

    if (!ESCROW_CONTRACT_ID) {
      toast.error({
        title: "Contract Not Configured",
        description: "NEXT_PUBLIC_ESCROW_CONTRACT_ID is missing from environment.",
      });
      return;
    }

    const jobIdBigInt = BigInt(jobId);
    const milestoneIndexNum = Number(milestoneIndex);

    await transaction.execute(
      {
        callerAddress: address,
        contractId: ESCROW_CONTRACT_ID,
        method: "release_funds",
        args: [
          nativeToScVal(jobIdBigInt, { type: "u64" }),
          Address.fromString(address).toScVal(),
          nativeToScVal(milestoneIndexNum, { type: "u32" }),
        ],
      },
      {
        onSuccess: (result) => {
          toast.success({
            title: "Milestone Released",
            description: "Funds have been released to the freelancer.",
            txHash: result.txHash,
          });

          // Trigger any UI state refresh here (e.g., refetch job data)
          console.log("Transaction confirmed:", result.txHash);
        },
        onError: (error) => {
          toast.error({
            title: "Transaction Failed",
            description: error.message,
          });
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Soroban Transaction Pipeline Example</CardTitle>
          <CardDescription>
            Demonstrates the Build → Simulate → Sign → Submit → Confirm flow
            with real-time progress tracking and dev diagnostics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="jobId" className="text-sm font-medium text-zinc-300">
                Job ID
              </label>
              <Input
                id="jobId"
                type="number"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                placeholder="1"
                disabled={transaction.isPending}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="milestoneIndex" className="text-sm font-medium text-zinc-300">
                Milestone Index
              </label>
              <Input
                id="milestoneIndex"
                type="number"
                value={milestoneIndex}
                onChange={(e) => setMilestoneIndex(e.target.value)}
                placeholder="0"
                disabled={transaction.isPending}
              />
            </div>
          </div>

          <Button
            onClick={() => void handleReleaseMilestone()}
            disabled={!isConnected || transaction.isPending || !ESCROW_CONTRACT_ID}
            className="w-full"
          >
            {transaction.isPending ? "Processing…" : "Release Milestone"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-amber-400">
              Connect your wallet to submit transactions.
            </p>
          )}

          {!ESCROW_CONTRACT_ID && (
            <p className="text-xs text-red-400">
              Escrow contract ID is not configured in environment variables.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Visual progress tracker */}
      {transaction.step !== "idle" && (
        <TransactionPipeline
          step={transaction.step}
          txHash={transaction.txHash}
          message={transaction.message}
          error={transaction.error}
          unsignedXdr={transaction.unsignedXdr}
          signedXdr={transaction.signedXdr}
          simulationLog={transaction.simulationLog}
        />
      )}

      {/* Progress history (dev only) */}
      {process.env.NODE_ENV !== "production" && transaction.progressHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress History</CardTitle>
            <CardDescription>
              All pipeline events for the current transaction (dev only)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-xs">
              {transaction.progressHistory.map((event, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                >
                  <span className="shrink-0 font-mono text-zinc-500">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-300">{event.step}</p>
                    <p className="mt-0.5 text-zinc-500">{event.message}</p>
                    {event.txHash && (
                      <p className="mt-1 break-all font-mono text-[10px] text-indigo-400">
                        {event.txHash}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
