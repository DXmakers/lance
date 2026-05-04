import { WalletGuard } from "@/components/state/wallet-guard";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletGuard>{children}</WalletGuard>;
}