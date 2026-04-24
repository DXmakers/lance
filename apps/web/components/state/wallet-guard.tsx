"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/use-auth-store";

interface WalletGuardProps {
  children: React.ReactNode;
  redirectTo?: string;
}

export function WalletGuard({
  children,
  redirectTo = "/",
}: WalletGuardProps) {
  const { isLoggedIn, hydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !isLoggedIn) {
      router.replace(redirectTo);
    }
  }, [hydrated, isLoggedIn, redirectTo, router]);

  // While hydrating, render nothing to avoid flash
  if (!hydrated) return null;

  // Not logged in — redirect is in progress
  if (!isLoggedIn) return null;

  return <>{children}</>;
}