import { WalletGuard } from "@/components/state/wallet-guard";

export default function DisputesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletGuard>{children}</WalletGuard>;
}