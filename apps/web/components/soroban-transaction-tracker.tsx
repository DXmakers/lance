/**
 * soroban-transaction-tracker.tsx
 *
 * Technical transaction progress tracker UI for Soroban resource fee estimation.
 *
 * Features:
 *  - Multi-step progress visualization (Build → Simulate → Sign → Submit → Confirm)
 *  - Monospace typography for XDR and hashes
 *  - Pulsing animations for network wait states
 *  - High-contrast status messages
 *  - Direct links to block explorers
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  FileCode,
  Zap,
  Wallet,
  Send,
  Clock,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PipelineStep, SimulationLog, PipelineResult } from "@/lib/soroban-pipeline";
import { FeeBreakdown, ResourceWarning } from "@/lib/soroban-resource-estimator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionTrackerProps {
  /** Current pipeline step */
  step: PipelineStep;
  /** Progress message */
  message: string;
  /** Transaction hash (available after submit) */
  txHash?: string;
  /** Simulation log (available after simulate) */
  simulationLog?: SimulationLog;
  /** Unsigned XDR for debugging */
  unsignedXdr?: string;
  /** Signed XDR for debugging */
  signedXdr?: string;
  /** Final result (success state) */
  result?: PipelineResult;
  /** Error state */
  error?: Error | null;
  /** Callback to retry on error */
  onRetry?: () => void;
  /** Callback to view on explorer */
  onViewExplorer?: (txHash: string) => void;
  /** Network (testnet/mainnet) for explorer links */
  network?: "testnet" | "mainnet" | "futurenet";
  /** Show detailed technical info (dev mode) */
  showTechnicalDetails?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface StepConfig {
  id: PipelineStep;
  label: string;
  icon: React.ReactNode;
  description: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const STEPS: StepConfig[] = [
  {
    id: "idle",
    label: "Ready",
    icon: <Activity className="h-4 w-4" />,
    description: "Waiting to start",
  },
  {
    id: "building",
    label: "Build",
    icon: <FileCode className="h-4 w-4" />,
    description: "Constructing transaction",
  },
  {
    id: "simulating",
    label: "Simulate",
    icon: <Zap className="h-4 w-4" />,
    description: "Estimating fees and resources",
  },
  {
    id: "signing",
    label: "Sign",
    icon: <Wallet className="h-4 w-4" />,
    description: "Waiting for signature",
  },
  {
    id: "submitting",
    label: "Submit",
    icon: <Send className="h-4 w-4" />,
    description: "Submitting to network",
  },
  {
    id: "confirming",
    label: "Confirm",
    icon: <Clock className="h-4 w-4" />,
    description: "Waiting for confirmation",
  },
  {
    id: "success",
    label: "Success",
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: "Transaction confirmed",
  },
  {
    id: "error",
    label: "Error",
    icon: <XCircle className="h-4 w-4" />,
    description: "Transaction failed",
  },
];

const STEP_ORDER: PipelineStep[] = [
  "idle",
  "building",
  "simulating",
  "signing",
  "submitting",
  "confirming",
  "success",
];

// ─── Component ──────────────────────────────────────────────────────────────────

export function SorobanTransactionTracker({
  step,
  message,
  txHash,
  simulationLog,
  unsignedXdr,
  signedXdr,
  result,
  error,
  onRetry,
  onViewExplorer,
  network = "testnet",
  showTechnicalDetails = false,
  className,
}: TransactionTrackerProps) {
  // Calculate progress percentage
  const currentStepIndex = STEP_ORDER.indexOf(step);
  const progressPercent =
    step === "success"
      ? 100
      : step === "error"
      ? Math.max((currentStepIndex / STEP_ORDER.length) * 100, 10)
      : (currentStepIndex / STEP_ORDER.length) * 100;

  // Get explorer URL
  const getExplorerUrl = (hash: string) => {
    const baseUrl =
      network === "mainnet"
        ? "https://stellar.expert/explorer/public"
        : network === "futurenet"
        ? "https://stellar.expert/explorer/futurenet"
        : "https://stellar.expert/explorer/testnet";
    return `${baseUrl}/tx/${hash}`;
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Render step indicator
  const renderStepIndicator = (stepConfig: StepConfig, index: number) => {
    const isActive = step === stepConfig.id;
    const isCompleted =
      STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf(stepConfig.id);
    const isPending =
      STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf(stepConfig.id) &&
      stepConfig.id !== "error";

    return (
      <div
        key={stepConfig.id}
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg transition-all duration-300",
          isActive && "bg-primary/10 ring-1 ring-primary",
          isCompleted && "text-muted-foreground",
          isPending && "opacity-50"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-full text-xs font-mono",
            isActive && "bg-primary text-primary-foreground animate-pulse",
            isCompleted && "bg-green-500/20 text-green-600",
            isPending && "bg-muted text-muted-foreground"
          )}
        >
          {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : stepConfig.icon}
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium">{stepConfig.label}</span>
          {isActive && (
            <span className="text-[10px] text-muted-foreground animate-pulse">
              {stepConfig.description}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className={cn("w-full max-w-2xl", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Transaction Status
          </CardTitle>
          <Badge
            variant={
              step === "success"
                ? "default"
                : step === "error"
                ? "destructive"
                : "secondary"
            }
            className="font-mono text-xs"
          >
            {step.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-sm text-muted-foreground text-center">{message}</p>
        </div>

        {/* Step Indicators */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {STEPS.filter((s) => s.id !== "error" && s.id !== "idle").map(
            (stepConfig, index) => renderStepIndicator(stepConfig, index)
          )}
        </div>

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Transaction Failed</AlertTitle>
            <AlertDescription className="font-mono text-xs mt-2">
              {error.message}
            </AlertDescription>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="mt-4"
              >
                Retry Transaction
              </Button>
            )}
          </Alert>
        )}

        {/* Success State */}
        {step === "success" && result && (
          <Alert className="bg-green-500/10 border-green-500/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Transaction Confirmed</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Your transaction has been successfully recorded on the blockchain.
              </p>
              {result.txHash && (
                <div className="flex items-center gap-2">
                  <code className="px-2 py-1 bg-muted rounded text-xs font-mono">
                    {result.txHash.slice(0, 16)}...{result.txHash.slice(-16)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(result.txHash)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onViewExplorer?.(result.txHash)}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Technical Details Accordion */}
        {(showTechnicalDetails || simulationLog) && (
          <Accordion type="single" collapsible className="w-full">
            {/* Simulation Details */}
            {simulationLog && (
              <AccordionItem value="simulation">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Simulation Results
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Base Fee:</span>
                        <code className="ml-2 font-mono">
                          {parseInt(simulationLog.baseFee).toLocaleString()} stroops
                        </code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Resource Fee:</span>
                        <code className="ml-2 font-mono">
                          {parseInt(simulationLog.resourceFee).toLocaleString()} stroops
                        </code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total:</span>
                        <code className="ml-2 font-mono text-green-600">
                          {parseInt(simulationLog.estimatedTotalFee).toLocaleString()} stroops
                        </code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">XLM:</span>
                        <code className="ml-2 font-mono">
                          {(
                            parseInt(simulationLog.estimatedTotalFee) / 10_000_000
                          ).toFixed(7)} XLM
                        </code>
                      </div>
                    </div>

                    <div className="border-t pt-3 mt-3">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">
                        Resource Usage
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span>CPU:</span>
                          <code className="font-mono">
                            {parseInt(simulationLog.cpuInsns).toLocaleString()} insns
                          </code>
                        </div>
                        <div className="flex justify-between">
                          <span>Memory:</span>
                          <code className="font-mono">
                            {parseInt(simulationLog.memBytes).toLocaleString()} bytes
                          </code>
                        </div>
                        <div className="flex justify-between">
                          <span>Read:</span>
                          <code className="font-mono">
                            {simulationLog.readBytes.toLocaleString()} bytes
                          </code>
                        </div>
                        <div className="flex justify-between">
                          <span>Write:</span>
                          <code className="font-mono">
                            {simulationLog.writeBytes.toLocaleString()} bytes
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* XDR Details */}
            {(unsignedXdr || signedXdr) && (
              <AccordionItem value="xdr">
                <AccordionTrigger className="text-sm">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4" />
                    Raw XDR (Dev Mode)
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    {unsignedXdr && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">
                            Unsigned XDR
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => copyToClipboard(unsignedXdr)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <textarea
                          readOnly
                          value={unsignedXdr}
                          className="w-full h-24 p-2 text-[10px] font-mono bg-muted rounded resize-none"
                        />
                      </div>
                    )}
                    {signedXdr && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">
                            Signed XDR
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => copyToClipboard(signedXdr)}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <textarea
                          readOnly
                          value={signedXdr}
                          className="w-full h-24 p-2 text-[10px] font-mono bg-muted rounded resize-none"
                        />
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}

        {/* Explorer Link */}
        {txHash && step !== "success" && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(getExplorerUrl(txHash), "_blank")}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View on Explorer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Fee Display Component ──────────────────────────────────────────────────────

export interface FeeDisplayProps {
  /** Fee breakdown from simulation */
  fees: FeeBreakdown;
  /** Resource warnings */
  warnings?: ResourceWarning[];
  /** Compact mode */
  compact?: boolean;
  className?: string;
}

export function FeeDisplay({
  fees,
  warnings,
  compact = false,
  className,
}: FeeDisplayProps) {
  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge variant="secondary" className="font-mono text-xs">
          {fees.totalFeeXlm} XLM
        </Badge>
        {warnings && warnings.length > 0 && (
          <Badge variant="destructive" className="text-xs">
            {warnings.length} Warning{warnings.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Fee Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Base Fee</span>
            <code className="font-mono">
              {parseInt(fees.baseFee).toLocaleString()} stroops
            </code>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Resource Fee</span>
            <code className="font-mono">
              {parseInt(fees.resourceFee).toLocaleString()} stroops
            </code>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Refundable</span>
            <code className="font-mono text-green-600">
              {parseInt(fees.refundableFee).toLocaleString()} stroops
            </code>
          </div>
          <div className="border-t pt-2 flex justify-between font-medium">
            <span>Total</span>
            <div className="text-right">
              <code className="font-mono block">
                {parseInt(fees.totalFee).toLocaleString()} stroops
              </code>
              <span className="text-xs text-muted-foreground">
                {fees.totalFeeXlm} XLM
              </span>
            </div>
          </div>
        </div>

        {warnings && warnings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-destructive">Warnings</h4>
            {warnings.map((warning, index) => (
              <Alert key={index} variant="warning" className="py-2">
                <AlertDescription className="text-xs">
                  {warning.message}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
