"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/use-auth-store";

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const setHydrated = useAuthStore((state) => state.setHydrated);

  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  return <>{children}</>;
}
