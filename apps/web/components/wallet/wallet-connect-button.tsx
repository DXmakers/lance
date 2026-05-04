"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WalletProviderIcon } from "@/components/wallet/wallet-provider-icon";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import {
  connectWalletWithInfo,
  getConnectedWalletAddress,
  getSelectedWalletId,
  getWalletInfo,
} from "@/lib/stellar";

function truncate(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const address = useWalletStore((state) => state.address);
  const walletId = useWalletStore((state) => state.walletId);
  const setConnection = useWalletStore((state) => state.setConnection);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletIcon, setWalletIcon] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (address && walletId) return;
    const storedId = getSelectedWalletId();
    if (!storedId) return;
    let cancelled = false;
    (async () => {
      const [connectedAddress, meta] = await Promise.all([
        getConnectedWalletAddress(),
        getWalletInfo(storedId),
      ]);
      if (cancelled || !connectedAddress || !meta) return;
      setConnection(connectedAddress, meta.id);
      setWalletName(meta.name);
      setWalletIcon(meta.icon);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, walletId, setConnection]);

  async function handleConnect() {
    if (connecting) return;
    setConnecting(true);
    try {
      const wallet = await connectWalletWithInfo();
      setConnection(wallet.address, wallet.walletId);
      setWalletName(wallet.walletName);
      setWalletIcon(wallet.walletIcon);
    } catch {
      // User dismissed modal or extension errored; silent fail keeps UI stable.
    } finally {
      setConnecting(false);
    }
  }

  if (address) {
    return (
      <div
        className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-sm md:flex"
        aria-label={`Connected to ${walletName ?? walletId}`}
      >
        <WalletProviderIcon
          walletName={walletName ?? undefined}
          walletIcon={walletIcon ?? undefined}
          size={18}
        />
        <span className="font-medium text-foreground">{walletName ?? walletId}</span>
        <span className="text-xs text-muted-foreground">{truncate(address)}</span>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleConnect}
      disabled={connecting}
      className="rounded-full"
      aria-label="Connect Stellar wallet"
    >
      <Wallet className="mr-2 h-4 w-4" />
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
