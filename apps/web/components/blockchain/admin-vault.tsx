"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TransactionPipeline } from "./transaction-pipeline";
import { useSorobanTransaction } from "@/hooks/use-soroban-transaction";
import { useWalletSession } from "@/hooks/use-wallet-session";

const ADMIN_VAULT_CONTRACT_ID = "C_ADMIN_VAULT_CONTRACT_ID";
const ADMIN_VAULT_METHOD = "deposit_admin_keys";

export function AdminVault() {
    const { address, isConnected } = useWalletSession();
    const transaction = useSorobanTransaction();
    const [lastTxHash, setLastTxHash] = useState<string | null>(null);

    async function handleDepositAdminKeys() {
        if (!address) {
            return;
        }

        await transaction.execute(
            {
                callerAddress: address,
                contractId: ADMIN_VAULT_CONTRACT_ID,
                method: ADMIN_VAULT_METHOD,
                args: [],
            },
            {
                onSuccess: (result) => {
                    setLastTxHash(result.txHash);
                },
            },
        );
    }

    const hasSucceeded = transaction.step === "success" && (transaction.txHash || lastTxHash);
    const txHash = transaction.txHash ?? lastTxHash;

    return (
        <div className="space-y-6">
            <Card className="border-slate-200 bg-white/90 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.45)]">
                <CardHeader>
                    <CardTitle className="text-balance text-2xl font-semibold tracking-tight text-slate-950">
                        Secure Vault for Admin Keys
                    </CardTitle>
                    <CardDescription className="max-w-2xl text-slate-600">
                        Deposit the connected admin wallet into the vault contract through a Soroban
                        transaction. The flow below shows the exact Build, Simulate, Sign, Submit,
                        and Confirm states.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                Connected Admin
                            </span>
                            <span className="font-mono text-sm text-slate-900">
                                {isConnected && address ? address : "No wallet connected"}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                Vault Contract
                            </span>
                            <span className="font-mono text-sm text-slate-900">
                                {ADMIN_VAULT_CONTRACT_ID}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                Method
                            </span>
                            <span className="font-mono text-sm text-slate-900">
                                {ADMIN_VAULT_METHOD}
                            </span>
                        </div>
                    </div>

                    <Button
                        onClick={() => void handleDepositAdminKeys()}
                        disabled={!isConnected || transaction.isPending}
                        className="w-full bg-slate-950 text-white hover:bg-slate-800"
                    >
                        {transaction.isPending ? "Processing vault deposit…" : "Deposit Admin Keys"}
                    </Button>

                    {!isConnected && (
                        <p className="text-sm text-amber-700">
                            Connect the admin wallet before depositing keys into the vault.
                        </p>
                    )}

                    {hasSucceeded && txHash ? (
                        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-emerald-950">
                                        Vault deposit confirmed
                                    </p>
                                    <p className="text-xs text-emerald-800">
                                        Admin keys were submitted successfully to the secure vault.
                                    </p>
                                </div>
                                <a
                                    href={`https://testnet.stellarchain.io/transactions/${txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-xs font-semibold text-emerald-950 underline decoration-emerald-500/70 underline-offset-4 hover:text-emerald-700"
                                >
                                    {txHash}
                                </a>
                            </div>
                        </div>
                    ) : null}

                    {transaction.step === "error" && transaction.error ? (
                        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 shadow-sm">
                            <p className="text-sm font-semibold text-red-950">Vault deposit failed</p>
                            <p className="mt-1 text-sm text-red-800">{transaction.error}</p>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {transaction.step !== "idle" ? (
                <TransactionPipeline
                    step={transaction.step}
                    txHash={transaction.txHash}
                    message={transaction.message}
                    error={transaction.error}
                    unsignedXdr={transaction.unsignedXdr}
                    signedXdr={transaction.signedXdr}
                    simulationLog={transaction.simulationLog}
                />
            ) : null}
        </div>
    );
}