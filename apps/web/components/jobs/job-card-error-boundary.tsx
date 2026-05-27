"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobCardErrorBoundaryProps {
  children: React.ReactNode;
  className?: string;
}

interface JobCardErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class JobCardErrorBoundary extends React.Component<
  JobCardErrorBoundaryProps,
  JobCardErrorBoundaryState
> {
  state: JobCardErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): JobCardErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={cn(
            "rounded-3xl border border-red-500/30 bg-red-500/5 p-6 text-center",
            this.props.className,
          )}
          role="alert"
        >
          <div className="flex items-center justify-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            <p className="text-sm font-semibold uppercase tracking-[0.2em]">
              Job unavailable
            </p>
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            This listing failed to load. Please try again.
          </p>
          <button
            onClick={this.handleRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}