"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex min-h-[200px] w-full flex-col items-center justify-center rounded-[24px] border border-amber-500/20 bg-amber-500/5 p-8 text-center">
          <AlertTriangle className="mb-4 h-8 w-8 text-amber-500" />
          <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
          <p className="mt-2 text-sm text-amber-200/70">
            The component failed to load. Try refreshing the page or contact support if the issue persists.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="mt-6 rounded-full bg-amber-500 px-6 py-2 text-xs font-bold text-black hover:bg-amber-400"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
