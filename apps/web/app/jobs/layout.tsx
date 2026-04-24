import { WalletGuard } from "@/components/state/wallet-guard";

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletGuard>{children}</WalletGuard>;
}