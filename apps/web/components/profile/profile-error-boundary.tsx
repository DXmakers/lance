"use client";

import React from "react";
import { Button } from "@/components/ui/button";

interface ProfileErrorBoundaryState {
  hasError: boolean;
}

export class ProfileErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ProfileErrorBoundaryState
> {
  state: ProfileErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ProfileErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-[24px] border border-rose-500/30 bg-zinc-950/90 p-6 text-zinc-100 shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">
            Profile module unavailable
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            We could not render this profile surface.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            The rest of the application is still safe. Retry just this module without
            dropping the current session.
          </p>
          <Button
            type="button"
            onClick={this.handleRetry}
            className="mt-5 rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
          >
            Retry profile module
          </Button>
        </section>
      );
    }

    return this.props.children;
  }
}
