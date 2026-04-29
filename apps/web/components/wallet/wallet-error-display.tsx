"use client";

import { AlertTriangle, Info, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

interface WalletErrorDisplayProps {
  error: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Wallet Error Display Component
 * 
 * Provides comprehensive error information with recovery steps
 * Follows the Zinc-900/Indigo-500 design system
 */
export function WalletErrorDisplay({ 
  error, 
  onRetry, 
  onDismiss, 
  className 
}: WalletErrorDisplayProps) {
  if (!error) return null;

  // Parse error to determine type and recovery steps
  const getErrorInfo = () => {
    let recoverySteps: string[] = [];
    let severity: 'low' | 'medium' = 'medium';

    if (error.includes("rejected") || error.includes("cancelled")) {
      recoverySteps = [
        "Check your wallet extension popup",
        "Click 'Approve' or 'Connect' in your wallet",
        "Try connecting again"
      ];
      severity = 'low';
    } else if (error.includes("not found") || error.includes("not installed")) {
      recoverySteps = [
        "Install Freighter, Albedo, or xBull wallet",
        "Enable the wallet extension in your browser",
        "Refresh the page and try again"
      ];
      severity = 'medium';
    } else if (error.includes("locked")) {
      recoverySteps = [
        "Open your wallet extension",
        "Enter your password to unlock",
        "Try connecting again"
      ];
      severity = 'medium';
    } else if (error.includes("connection")) {
      recoverySteps = [
        "Check your internet connection",
        "Ensure wallet extension is enabled",
        "Try refreshing the page"
      ];
      severity = 'medium';
    } else {
      recoverySteps = [
        "Refresh the page",
        "Check your wallet extension",
        "Try connecting again"
      ];
    }

    return { recoverySteps, severity };
  };

  const { recoverySteps, severity } = getErrorInfo();

  const getSeverityColors = () => {
    switch (severity) {
      case 'low':
        return {
          bg: 'bg-amber-500/10',
          border: 'border-amber-500/30',
          text: 'text-amber-400',
          icon: 'text-amber-400'
        };
      default: // 'medium'
        return {
          bg: 'bg-orange-500/10',
          border: 'border-orange-500/30',
          text: 'text-orange-400',
          icon: 'text-orange-400'
        };
    }
  };

  const colors = getSeverityColors();

  return (
    <div className={cn(
      "rounded-[12px] p-4 transition-all duration-200",
      colors.bg,
      colors.border,
      "border",
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <AlertTriangle className={cn("h-5 w-5 animate-pulse", colors.icon)} aria-hidden="true" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className={cn("text-sm font-medium", colors.text)}>
              Connection Error
            </h3>
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-400"
                aria-label="Dismiss error"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          
          <p className="text-xs text-zinc-300 mb-3 leading-relaxed">
            {error}
          </p>
          
          {recoverySteps.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Info className="h-3 w-3 text-indigo-400" aria-hidden="true" />
                <span className="text-xs font-medium text-indigo-400">Recovery Steps:</span>
              </div>
              
              <ol className="space-y-1.5">
                {recoverySteps.map((step, index) => (
                  <li key={index} className="flex items-start gap-2 text-xs text-zinc-400">
                    <span className="flex-shrink-0 w-4 h-4 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] text-zinc-500 mt-0.5">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          
          {onRetry && (
            <div className="mt-4 pt-3 border-t border-zinc-700/50">
              <Button
                size="sm"
                onClick={onRetry}
                className="rounded-[8px] bg-indigo-600 text-xs font-medium text-white transition-all duration-200 hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" />
                Try Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface WalletErrorBannerProps {
  error: string | null;
  onRetry?: () => void;
  className?: string;
}

/**
 * Compact error banner for inline display
 */
export function WalletErrorBanner({ error, onRetry, className }: WalletErrorBannerProps) {
  if (!error) return null;

  return (
    <div className={cn(
      "flex items-center gap-2 rounded-[12px] bg-red-500/10 border border-red-500/30 px-3 py-2",
      className
    )}>
      <AlertTriangle className="h-4 w-4 text-red-400 animate-pulse flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-red-400 font-medium truncate">
          {error}
        </p>
      </div>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-6 w-6 p-0 text-red-400 hover:text-red-300 flex-shrink-0"
          aria-label="Retry connection"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
