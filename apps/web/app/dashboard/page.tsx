"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  BarChart2,
  Clock,
  Code2,
  ExternalLink,
  Globe,
  LayoutGrid,
  Package,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { SidebarNavigation } from "@/components/dashboard/sidebar-navigation";
import { GlassCard } from "@/components/dashboard/glass-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { shortenAddress, formatDate, formatUsdc } from "@/lib/format";

type DeploymentStatus = "live" | "pending" | "failed";
type Network = "testnet" | "mainnet";

interface ContractDeployment {
  id: string;
  contractId: string;
  name: string;
  network: Network;
  status: DeploymentStatus;
  deployedAt: string;
  txHash: string;
  verified: boolean;
  interactionCount: number;
  lastInteractionAt: string | null;
}

interface ActivityEntry {
  id: string;
  type: "deployment" | "interaction" | "dispute" | "payment";
  description: string;
  network: Network;
  txHash: string;
  timestamp: string;
  amountUsdc?: number;
}

const MOCK_DEPLOYMENTS: ContractDeployment[] = [
  {
    id: "dep-1",
    contractId: "CDBLWJKQLC2XVKVT7K3T2ZAIJGI7K7XRK6YMMHBBSWQI42WUZZHNQL4I",
    name: "Escrow v2.1",
    network: "mainnet",
    status: "live",
    deployedAt: "2026-04-10T09:22:00Z",
    txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    verified: true,
    interactionCount: 142,
    lastInteractionAt: "2026-05-28T18:45:00Z",
  },
  {
    id: "dep-2",
    contractId: "CA7JEZGXWTX62LE6HSW7C6DQHDFNEKEFYI2AYNXU67AJPKIKNRINTCHB",
    name: "Job Registry v1.0",
    network: "testnet",
    status: "live",
    deployedAt: "2026-03-05T14:10:00Z",
    txHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    verified: true,
    interactionCount: 89,
    lastInteractionAt: "2026-05-27T11:20:00Z",
  },
  {
    id: "dep-3",
    contractId: "CDPOR7XAJDYSPCQMLM5AJESL4IOC7L2J34GW5UKSTC6NX7Z4GG53OLEF",
    name: "Reputation Oracle",
    network: "testnet",
    status: "pending",
    deployedAt: "2026-05-20T08:00:00Z",
    txHash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    verified: false,
    interactionCount: 0,
    lastInteractionAt: null,
  },
];

const MOCK_ACTIVITY: ActivityEntry[] = [
  {
    id: "act-1",
    type: "payment",
    description: "Milestone payment released — DeFi Dashboard project",
    network: "mainnet",
    txHash: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
    timestamp: "2026-05-28T18:45:00Z",
    amountUsdc: 2500,
  },
  {
    id: "act-2",
    type: "deployment",
    description: "Deployed Escrow v2.1 to Stellar mainnet",
    network: "mainnet",
    txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    timestamp: "2026-04-10T09:22:00Z",
  },
  {
    id: "act-3",
    type: "interaction",
    description: "Invoked escrow.release() — job #88 final milestone",
    network: "mainnet",
    txHash: "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
    timestamp: "2026-04-08T14:33:00Z",
    amountUsdc: 8500,
  },
  {
    id: "act-4",
    type: "dispute",
    description: "Dispute opened on job #92 — awaiting AI judge verdict",
    network: "testnet",
    txHash: "f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1",
    timestamp: "2026-03-18T10:05:00Z",
  },
];

const ACTIVITY_ICONS: Record<ActivityEntry["type"], React.ReactNode> = {
  deployment: <Package className="w-4 h-4 text-blue-400" />,
  interaction: <Code2 className="w-4 h-4 text-emerald-400" />,
  payment: <Zap className="w-4 h-4 text-yellow-400" />,
  dispute: <Activity className="w-4 h-4 text-red-400" />,
};

const NETWORK_STYLES: Record<Network, string> = {
  mainnet: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  testnet: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const STATUS_DOT: Record<DeploymentStatus, string> = {
  live: "bg-emerald-400",
  pending: "bg-amber-400 animate-pulse",
  failed: "bg-red-400",
};

const EXPLORER_BASE: Record<Network, string> = {
  mainnet: "https://stellar.expert/explorer/public/contract",
  testnet: "https://stellar.expert/explorer/testnet/contract",
};

function DeploymentRow({ d }: { d: ContractDeployment }) {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-zinc-800 last:border-0">
      <div className="mt-1">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[d.status]}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-zinc-100 font-medium text-sm">{d.name}</span>
          {d.verified && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
              <BadgeCheck className="w-3 h-3" />
              Verified
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 ${NETWORK_STYLES[d.network]}`}
          >
            <Globe className="w-3 h-3" />
            {d.network}
          </span>
        </div>

        <p className="text-zinc-400 text-xs mt-0.5 font-mono truncate">
          {shortenAddress(d.contractId)}
        </p>

        <div className="flex items-center gap-4 mt-1.5 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Deployed {formatDate(d.deployedAt)}
          </span>
          <span className="flex items-center gap-1">
            <BarChart2 className="w-3 h-3" />
            {d.interactionCount} calls
          </span>
          {d.lastInteractionAt && (
            <span className="hidden sm:flex items-center gap-1">
              Last used {formatDate(d.lastInteractionAt)}
            </span>
          )}
        </div>
      </div>

      <a
        href={`${EXPLORER_BASE[d.network]}/${d.contractId}`}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors"
        title="View on Stellar Expert"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-zinc-800 last:border-0">
      <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
        {ACTIVITY_ICONS[entry.type]}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-zinc-300 text-sm leading-snug">{entry.description}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
          <span>{formatDate(entry.timestamp)}</span>
          <span
            className={`border rounded-full px-1.5 py-0.5 ${NETWORK_STYLES[entry.network]}`}
          >
            {entry.network}
          </span>
          {entry.amountUsdc !== undefined && (
            <span className="text-yellow-400 font-medium">{formatUsdc(entry.amountUsdc)}</span>
          )}
        </div>
      </div>

      <a
        href={`https://stellar.expert/explorer/${entry.network}/tx/${entry.txHash}`}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
        title="View transaction"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

export default function DeveloperDashboard() {
  const [activeTab, setActiveTab] = useState<"deployments" | "activity">("deployments");

  const deployments = MOCK_DEPLOYMENTS;
  const activity = MOCK_ACTIVITY;

  const liveCount = deployments.filter((d) => d.status === "live").length;
  const verifiedCount = deployments.filter((d) => d.verified).length;
  const totalInteractions = deployments.reduce((sum, d) => sum + d.interactionCount, 0);
  const totalValueUsdc = activity
    .filter((a) => a.amountUsdc !== undefined)
    .reduce((sum, a) => sum + (a.amountUsdc ?? 0), 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      <SidebarNavigation />

      <main className="flex-1 p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Developer Portfolio</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Deployment history and on-chain contract interactions across Stellar networks.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Live Contracts",
              value: liveCount,
              icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
              accent: "text-emerald-400",
            },
            {
              label: "Verified On-chain",
              value: verifiedCount,
              icon: <BadgeCheck className="w-4 h-4 text-blue-400" />,
              accent: "text-blue-400",
            },
            {
              label: "Total Invocations",
              value: totalInteractions,
              icon: <Code2 className="w-4 h-4 text-purple-400" />,
              accent: "text-purple-400",
            },
            {
              label: "Volume (USDC)",
              value: `$${totalValueUsdc.toLocaleString()}`,
              icon: <Wallet className="w-4 h-4 text-yellow-400" />,
              accent: "text-yellow-400",
            },
          ].map((stat) => (
            <GlassCard key={stat.label} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-zinc-400 text-xs">
                {stat.icon}
                <span>{stat.label}</span>
              </div>
              <p className={`text-2xl font-bold ${stat.accent}`}>{stat.value}</p>
            </GlassCard>
          ))}
        </div>

        <div className="flex gap-1 border-b border-zinc-800 pb-0">
          {(["deployments", "activity"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? "border-emerald-400 text-emerald-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab === "deployments" ? (
                <span className="flex items-center gap-1.5">
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Deployments
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  Activity
                </span>
              )}
            </button>
          ))}
        </div>

        <GlassCard className="!p-0 overflow-hidden">
          {activeTab === "deployments" ? (
            <div className="divide-y divide-zinc-800">
              {deployments.length === 0 ? (
                <div className="py-16 text-center text-zinc-500 text-sm">
                  No deployments recorded yet.
                </div>
              ) : (
                <div className="px-6">
                  {deployments.map((d) => (
                    <DeploymentRow key={d.id} d={d} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {activity.length === 0 ? (
                <div className="py-16 text-center text-zinc-500 text-sm">
                  No on-chain activity yet.
                </div>
              ) : (
                <div className="px-6">
                  {activity.map((entry) => (
                    <ActivityItem key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          )}
        </GlassCard>

        <div className="text-center pt-2">
          <p className="text-zinc-600 text-xs">
            Data sourced from Stellar Horizon & Soroban RPC ·{" "}
            <a
              href="https://stellar.expert"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-400 transition-colors"
            >
              Stellar Expert
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
