"use client";

import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface WalletProviderIconProps {
  walletName?: string | null;
  walletIcon?: string | null;
  size?: number;
  className?: string;
}

/**
 * Renders the icon of the connected Stellar wallet provider
 * (Freighter, Albedo, xBull, ...). Falls back to a generic wallet glyph
 * when no provider metadata is available.
 *
 * Icon URLs supplied by `@creit.tech/stellar-wallets-kit` are typically
 * inline SVG data URIs, so a plain <img> keeps things simple and avoids
 * remote-loader configuration.
 */
export function WalletProviderIcon({
  walletName,
  walletIcon,
  size = 20,
  className,
}: WalletProviderIconProps) {
  const label = walletName
    ? `${walletName} wallet`
    : "No wallet connected";

  if (!walletIcon) {
    return (
      <Wallet
        aria-label={label}
        role="img"
        className={cn("text-muted-foreground", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={walletIcon}
      alt={label}
      width={size}
      height={size}
      className={cn("rounded-sm", className)}
      style={{ width: size, height: size }}
    />
  );
}
