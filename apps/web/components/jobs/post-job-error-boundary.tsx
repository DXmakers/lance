"use client";

import React from "react";
import { Button } from "@/components/ui/button";

interface PostJobErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PostJobErrorBoundary extends React.Component<
  { children: React.ReactNode },
  PostJobErrorBoundaryState
> {
  state: PostJobErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): PostJobErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("PostJobForm error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-[2rem] border border-rose-500/30 bg-zinc-950/90 p-6 text-zinc-100 shadow-[0_24px_80px_-56px_rgba(0,0,0,0.9)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">
            Job posting unavailable
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            We could not render the job posting form.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
            The rest of the application is still safe. Retry the form without
            losing any entered data.
          </p>
          <div className="mt-5 flex gap-3">
            <Button
              type="button"
              onClick={this.handleRetry}
              className="rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
            >
              Retry job form
            </Button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-zinc-700 px-6 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white"
            >
              Reload page
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
