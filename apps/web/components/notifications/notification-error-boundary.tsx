"use client";

import React from "react";

interface NotificationErrorBoundaryState {
  hasError: boolean;
}

export class NotificationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  NotificationErrorBoundaryState
> {
  state: NotificationErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): NotificationErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-amber-500/40 bg-zinc-900/90 p-3 text-xs text-amber-200">
          Notifications unavailable.
        </div>
      );
    }
    return this.props.children;
  }
}
