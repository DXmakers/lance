"use client";

import { useEffect } from "react";
import { useAuthStore, jwtMemory } from "@/lib/store/use-auth-store";
import { api } from "@/lib/api";

const JWT_SESSION_KEY = "lance_jwt";

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { setHydrated, setJwt } = useAuthStore();

  useEffect(() => {
    // Fetch CSRF token on initial load
    api.auth.getCsrf().catch(() => {
      // Ignore errors - CSRF token will be fetched when needed
    });

    const stored = sessionStorage.getItem(JWT_SESSION_KEY);
    if (stored) {
      jwtMemory.set(stored);
      setJwt(stored);
    }
    setHydrated(true);
  }, [setHydrated, setJwt]);

  return <>{children}</>;
}