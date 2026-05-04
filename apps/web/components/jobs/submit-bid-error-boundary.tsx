"use client";

import React from "react";

interface SubmitBidErrorBoundaryState {
  hasError: boolean;
}

export class SubmitBidErrorBoundary extends React.Component<
  React.PropsWithChildren,
  SubmitBidErrorBoundaryState
> {
  state: SubmitBidErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SubmitBidErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-[1.5rem] border border-amber-500/40 bg-zinc-950/85 p-5 text-amber-200">
          <p className="text-sm font-semibold uppercase tracking-[0.2em]">Bid action unavailable</p>
          <p className="mt-2 text-sm text-zinc-300">
            The bid form failed to load. Refresh and try again.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
