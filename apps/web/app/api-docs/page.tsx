"use client";

import React from "react";
import { useApiDocs } from "../../hooks/useApiDocs";
import { ApiEndpointCard } from "../../components/docs/ApiEndpoint";

/**
 * API Documentation Page
 * Displays a list of all API endpoints with a sticky sidebar for quick navigation.
 * Uses TanStack Query for data fetching and Zinc-950 dark mode theme.
 */
export default function ApiDocsPage() {
  const { data: endpoints, isLoading, error } = useApiDocs();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-zinc-800 border-t-emerald-500 animate-spin" />
          <p className="text-zinc-500 font-mono text-sm tracking-widest">LOADING API METADATA...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-8">
        <div className="p-6 rounded-xl border border-red-500/20 bg-red-500/5 backdrop-blur-md max-w-md text-center">
          <h1 className="text-red-400 font-bold mb-2">Simulation Failed</h1>
          <p className="text-zinc-400 text-sm">Failed to retrieve API documentation metadata. Please verify your connection to the decentralized network.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30 selection:text-emerald-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col lg:flex-row gap-12">
        
        {/* Sticky Sidebar */}
        <aside className="lg:w-64 shrink-0">
          <div className="sticky top-12">
            <h1 className="text-2xl font-bold mb-8 bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
              API Docs
            </h1>
            <nav className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-4 pl-3">
                Endpoints
              </p>
              {endpoints?.map((endpoint) => (
                <a
                  key={endpoint.id}
                  href={`#${endpoint.id}`}
                  className="block px-3 py-2 text-sm text-zinc-500 rounded-lg hover:text-zinc-200 hover:bg-zinc-900 transition-colors duration-150 border border-transparent hover:border-zinc-800"
                >
                  {endpoint.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 max-w-4xl">
          <header className="mb-16">
            <h2 className="text-4xl font-extrabold text-white mb-4 tracking-tight">
              Developer Reference
            </h2>
            <p className="text-lg text-zinc-400 leading-relaxed max-w-2xl">
              Build robust applications on top of our decentralized marketplace protocol. 
              Our APIs provide real-time access to jobs, milestones, and on-chain state.
            </p>
          </header>

          <div className="space-y-16">
            {endpoints?.map((endpoint) => (
              <ApiEndpointCard key={endpoint.id} endpoint={endpoint} />
            ))}
          </div>

          <footer className="mt-32 pt-8 border-t border-zinc-900 text-center">
            <p className="text-xs text-zinc-600 font-mono">
              © 2026 LANCE PROTOCOL — VERIFIED ON-CHAIN
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
