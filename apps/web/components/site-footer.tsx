"use client";

import Link from "next/link";
import Image from "next/image";
import { Gavel, Award, Shield, FileText, Cpu, ExternalLink } from "lucide-react";

export function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-zinc-800/40 bg-zinc-950 pt-16 pb-12 mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4 pb-12 border-b border-zinc-900/60">
          {/* Brand Info */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="relative h-8 w-8 overflow-hidden rounded bg-zinc-900 border border-zinc-800 p-0.5 flex items-center justify-center transition group-hover:border-primary/50">
                <Image 
                  src="/favicon.png" 
                  alt="Lance Logo" 
                  width={24} 
                  height={24} 
                  className="object-contain"
                />
              </div>
              <span className="text-lg font-bold tracking-tight text-zinc-50 group-hover:text-primary transition-all">
                LANCE
              </span>
            </Link>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-xs">
              A premium, minimalist freelance infrastructure built on the Stellar network. Guaranteeing trustless escrow, verifiable on-chain reputation, and objective AI-driven dispute resolution.
            </p>
          </div>

          {/* Quick Navigation */}
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
              Navigation
            </h4>
            <ul className="flex flex-col gap-2.5 text-sm">
              <li>
                <Link href="/" className="text-zinc-400 hover:text-zinc-50 transition">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/jobs" className="text-zinc-400 hover:text-zinc-50 transition">
                  Browse Jobs
                </Link>
              </li>
              <li>
                <Link href="/jobs/new" className="text-zinc-400 hover:text-zinc-50 transition">
                  Post a Job
                </Link>
              </li>
              <li>
                <Link href="/milestones" className="text-zinc-400 hover:text-zinc-50 transition">
                  Milestone Registry
                </Link>
              </li>
            </ul>
          </div>

          {/* Stellar Integrations */}
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
              Stellar & Soroban
            </h4>
            <ul className="flex flex-col gap-2.5 text-sm">
              <li>
                <a 
                  href="https://stellar.org" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-50 transition"
                >
                  Stellar Network
                  <ExternalLink className="h-3 w-3 text-zinc-600" />
                </a>
              </li>
              <li>
                <a 
                  href="https://soroban.stellar.org" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-50 transition"
                >
                  Soroban Dev Portal
                  <ExternalLink className="h-3 w-3 text-zinc-600" />
                </a>
              </li>
              <li>
                <a 
                  href="https://stellar.expert" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-50 transition"
                >
                  Stellar Expert Explorer
                  <ExternalLink className="h-3 w-3 text-zinc-600" />
                </a>
              </li>
            </ul>
          </div>

          {/* Platform Status / Judge Info */}
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">
              Arbitration & Security
            </h4>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Cpu className="h-4 w-4 text-primary/80" />
                <span>AI Judge: Active (OpenClaw)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Shield className="h-4 w-4 text-emerald-500/80" />
                <span>Soroban Escrow: Verified</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <FileText className="h-4 w-4 text-zinc-500" />
                <span>Escrow-as-a-Service model</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-8 text-xs text-zinc-500">
          <div>
            &copy; {currentYear} LANCE. Timeless trust on the blockchain.
          </div>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-zinc-300 transition">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-zinc-300 transition">
              Privacy Policy
            </Link>
            <Link href="/disputes" className="hover:text-zinc-300 transition">
              Dispute Resolution Guide
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
