"use client";

import { cn } from "@/lib/utils";

/**
 * Insufficient-balance alert (#179).
 *
 * Surfaced whenever the SDK / RPC reports `tx_insufficient_balance`,
 * `op_underfunded`, or any of the equivalent simulation strings (see
 * `isInsufficientBalanceError` in `lib/error-mapper.ts`). The component
 * focuses on giving the user a clear recovery path — required vs available
 * balance, the shortfall, and direct CTAs — instead of a generic toast.
 */
export interface InsufficientBalanceAlertProps {
  /** Asset symbol shown in the headline, defaults to "XLM". */
  asset?: string;
  /** Required amount to complete the transaction (string to preserve precision). */
  required: string;
  /** Wallet's available amount. */
  available: string;
  /** Optional faucet / fund URL CTA. */
  fundUrl?: string;
  /** Optional retry handler — wired up after the user funds their wallet. */
  onRetry?: () => void;
  /** Optional dismiss handler. When omitted the dismiss button is hidden. */
  onDismiss?: () => void;
  /** Optional explorer link for the failed transaction. */
  explorerUrl?: string;
  testId?: string;
  className?: string;
}

function formatShortfall(required: string, available: string): string | null {
  try {
    const r = Number.parseFloat(required);
    const a = Number.parseFloat(available);
    if (!Number.isFinite(r) || !Number.isFinite(a)) return null;
    const delta = r - a;
    if (delta <= 0) return null;
    return delta.toString();
  } catch {
    return null;
  }
}

export function InsufficientBalanceAlert({
  asset = "XLM",
  required,
  available,
  fundUrl,
  onRetry,
  onDismiss,
  explorerUrl,
  testId = "insufficient-balance-alert",
  className,
}: InsufficientBalanceAlertProps) {
  const shortfall = formatShortfall(required, available);

  return (
    <section
      role="alert"
      aria-labelledby={`${testId}-title`}
      className={cn(
        "rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3
            id={`${testId}-title`}
            className="text-sm font-semibold text-amber-100"
          >
            Insufficient {asset} balance
          </h3>
          <p className="mt-1 text-xs text-amber-200/80">
            Your wallet doesn&apos;t have enough {asset} to complete this transaction. Fund
            your wallet and try again.
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss insufficient balance alert"
            className="rounded-md p-1 text-amber-300 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            data-testid={`${testId}-dismiss`}
          >
            ×
          </button>
        )}
      </div>

      <dl
        className="mt-3 grid grid-cols-3 gap-3 font-mono text-xs"
        data-testid={`${testId}-balances`}
      >
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-amber-300/70">Required</dt>
          <dd className="text-amber-100" data-testid={`${testId}-required`}>
            {required} {asset}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-amber-300/70">Available</dt>
          <dd className="text-amber-100" data-testid={`${testId}-available`}>
            {available} {asset}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-amber-300/70">Shortfall</dt>
          <dd className="text-rose-300" data-testid={`${testId}-shortfall`}>
            {shortfall ? `${shortfall} ${asset}` : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2" data-testid={`${testId}-actions`}>
        {fundUrl && (
          <a
            href={fundUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            data-testid={`${testId}-fund`}
          >
            Fund wallet
          </a>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center rounded-md border border-amber-500/50 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:border-amber-400 hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            data-testid={`${testId}-retry`}
          >
            Retry transaction
          </button>
        )}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold text-amber-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            data-testid={`${testId}-explorer`}
          >
            View on explorer
          </a>
        )}
      </div>
    </section>
  );
}

export default InsufficientBalanceAlert;
