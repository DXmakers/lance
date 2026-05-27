"use client";

import { useEffect } from "react";
import Link from "next/link";
import { NetworkMismatchBanner } from "@/components/ui/network-mismatch-banner";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { Button } from "@/components/ui/button";
import {
  Search,
  Menu,
  LogOut,
  BriefcaseBusiness,
  LoaderCircle,
  TriangleAlert,
  Wallet,
  Unplug,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { SessionSwitcher } from "@/components/auth/session-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BlockchainSyncIndicator } from "@/components/ui/blockchain-sync-indicator";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { toast } from "@/lib/toast";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { NotificationCenter } from "@/components/notifications/notification-center";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function TopNav({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const { isLoggedIn, login, role, user, walletAddress } = useAuthStore();
  const { disconnect: disconnectAuth } = useWalletAuth();
  const {
    address,
    xlmBalance,
    appNetwork,
    walletNetwork,
    networkMismatch,
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect: disconnectSession,
  } = useWalletSession();

  useEffect(() => {
    if (!error) return;
    toast.error({
      title: "Wallet error",
      description: error,
    });
  }, [error]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <NetworkMismatchBanner />
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            className="inline-flex items-center justify-center rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>

          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-xs font-bold tracking-[0.28em] text-primary-foreground shadow-lg shadow-primary/20">
              LN
            </span>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Lance
              </p>
              <p className="text-base font-semibold text-foreground">
                {isLoggedIn ? `${role} workspace` : "Public network"}
              </p>
            </div>
          </Link>

          <nav className="ml-4 hidden items-center gap-3 xl:flex">
            <Link
              href="/jobs"
              className="rounded-full border border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card/80 hover:text-foreground"
            >
              Browse Jobs
            </Link>
            <Link
              href="/jobs/new"
              className="rounded-full border border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card/80 hover:text-foreground"
            >
              Post a Job
            </Link>
          </nav>
        </div>

        <div className="hidden flex-1 items-center justify-center px-4 lg:flex">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs, talents..."
              className="glass-surface pl-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden xl:block">
            <BlockchainSyncIndicator />
          </div>
          <div className="flex items-center gap-2 md:hidden">
            {isConnected && address ? (
              <button
                type="button"
                onClick={() => void disconnectSession()}
                aria-label="Disconnect Stellar wallet"
                className="inline-flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
              >
                <span>{xlmBalance ? `${Number(xlmBalance).toFixed(1)} XLM` : "XLM --"}</span>
                <span className="text-zinc-400">{shortAddress(address)}</span>
                <Unplug className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={isConnecting}
                aria-label="Connect Stellar wallet"
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isConnecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                {isConnecting ? "..." : "Connect"}
              </button>
            )}
            {networkMismatch ? (
              <span className="inline-flex items-center rounded-xl border border-indigo-500/40 bg-zinc-900 px-2 py-1 text-[10px] text-indigo-300">
                <TriangleAlert className="h-3 w-3" />
              </span>
            ) : null}
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {isConnected && address ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 transition-opacity duration-200">
                <span className="font-medium text-zinc-100">
                  {xlmBalance ? `${Number(xlmBalance).toFixed(2)} XLM` : "XLM --"}
                </span>
                <span className="text-zinc-400">{shortAddress(address)}</span>
                <button
                  type="button"
                  onClick={() => void disconnectSession()}
                  aria-label="Disconnect Stellar wallet"
                  className="inline-flex items-center text-zinc-400 hover:text-zinc-100"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={isConnecting}
                aria-label="Connect Stellar wallet"
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isConnecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                {isConnecting ? "Connecting..." : "Connect wallet"}
              </button>
            )}
            {networkMismatch ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-indigo-500/40 bg-zinc-900 px-2.5 py-1.5 text-xs text-indigo-300">
                <TriangleAlert className="h-3.5 w-3.5" />
                {walletNetwork} vs {appNetwork}
              </span>
            ) : null}
            {error ? (
              <span className="rounded-xl border border-indigo-500/40 bg-zinc-900 px-2.5 py-1.5 text-xs text-indigo-300">
                Wallet error
              </span>
            ) : null}
          </div>
          <SessionSwitcher />
          <ThemeToggle />
          <WalletConnect />
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              <NotificationCenter />
              <div className="hidden items-center gap-3 rounded-full border border-border/70 bg-card/70 px-2 py-1.5 md:flex">
                <Avatar className="h-8 w-8 border border-border/50">
                  <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                    {user?.name
                      ?.split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2) ?? "LN"}
                  </AvatarFallback>
                </Avatar>
                <div className="pr-2">
                  <p className="text-sm font-medium text-foreground">{user?.name}</p>
                  {walletAddress ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Wallet className="h-3 w-3" aria-hidden="true" />
                      {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  )}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                aria-label="Disconnect wallet and sign out"
                onClick={disconnectAuth}
                className="rounded-full transition-opacity duration-200 hover:opacity-80"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ConnectWalletButton />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  login({ name: "Amaka Client", email: "client@lance.so" }, "client")
                }
                className="rounded-full"
              >
                Client Log In
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  login(
                    { name: "Kehinde Freelancer", email: "freelancer@lance.so" },
                    "freelancer",
                  )
                }
                className="rounded-full"
              >
                <BriefcaseBusiness className="mr-2 h-4 w-4" />
                Freelancer Sign Up
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
