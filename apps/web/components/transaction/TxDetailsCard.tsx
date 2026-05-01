"use client";

/**
 * TxDetailsCard.tsx
 *
 * Technical details card showing transaction information.
 * Displays: Transaction Hash, XDR, Fee, Ledger Sequence
 * with copyable fields and collapsible sections.
 */

import React, { useState } from "react";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  Database,
  Code,
} from "lucide-react";
import { TransactionEvent } from "@/lib/transactions/lifecycle";

interface TxDetailsCardProps {
  /** Current transaction event */
  event: TransactionEvent | null;
  /** Network (testnet or public) */
  network?: "testnet" | "public";
}

/**
 * TxDetailsCard component showing technical transaction details.
 */
export function TxDetailsCard({
  event,
  network = "testnet",
}: TxDetailsCardProps) {
  const [expandedXdr, setExpandedXdr] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!event) {
    return null;
  }

  const { metadata, submission, devData } = event;
  const txHash = metadata.txHash;
  const unsignedXdr = devData?.unsignedXdr;
  const fee = submission?.hash ? "100" : undefined; // Placeholder fee
  const ledger = event.polling?.ledger;

  const explorerUrl =
    network === "public"
      ? `https://stellar.expert/explorer/public/tx/${txHash}`
      : `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  /**
   * Copies text to clipboard and shows feedback.
   */
  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("[TxDetailsCard] Failed to copy:", err);
    }
  };

  /**
   * Truncates long strings for display.
   */
  const truncate = (str: string, length: number = 16) => {
    if (str.length <= length) return str;
    return `${str.substring(0, length)}...${str.substring(str.length - 8)}`;
  };

  return (
    <div className="space-y-4">
      {/* Transaction Hash */}
      {txHash && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Transaction Hash
            </h3>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
            >
              View on Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 break-all">
              {txHash}
            </code>
            <button
              onClick={() => copyToClipboard(txHash, "txHash")}
              className="p-2 hover:bg-slate-100 rounded transition-colors"
              title="Copy transaction hash"
            >
              {copiedField === "txHash" ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Fee Information */}
      {fee && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-700">Fee</h3>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              {fee} stroops
            </code>
            <button
              onClick={() => copyToClipboard(fee, "fee")}
              className="p-2 hover:bg-slate-100 rounded transition-colors"
              title="Copy fee"
            >
              {copiedField === "fee" ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4 text-slate-400" />
              )}
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {(parseInt(fee) / 10_000_000).toFixed(7)} XLM
          </p>
        </div>
      )}

      {/* Ledger Sequence */}
      {ledger && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-slate-700">
              Ledger Sequence
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              {ledger}
            </code>
            <button
              onClick={() => copyToClipboard(String(ledger), "ledger")}
              className="p-2 hover:bg-slate-100 rounded transition-colors"
              title="Copy ledger sequence"
            >
              {copiedField === "ledger" ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* XDR (Collapsible) */}
      {unsignedXdr && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <button
            onClick={() => setExpandedXdr(!expandedXdr)}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Code className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">
                Transaction XDR
              </h3>
              <span className="text-xs text-slate-500">
                ({truncate(unsignedXdr, 20)})
              </span>
            </div>
            {expandedXdr ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {expandedXdr && (
            <div className="border-t border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-slate-700 break-all max-h-48 overflow-y-auto">
                  {unsignedXdr}
                </code>
                <button
                  onClick={() => copyToClipboard(unsignedXdr, "xdr")}
                  className="p-2 hover:bg-white rounded transition-colors flex-shrink-0"
                  title="Copy XDR"
                >
                  {copiedField === "xdr" ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-slate-400" />
                  )}
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                This XDR represents the exact operations being sent to the Stellar network.
                Use this for verification or debugging.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
