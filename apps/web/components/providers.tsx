"use client";

import { ThemeProvider } from "next-themes";
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";
import { getQueryClient } from "@/lib/query-client";
import { TransactionSigningProvider } from "@/components/blockchain/transaction-signing-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="lance-theme"
      >
        <AuthBootstrap>
          <TransactionSigningProvider>
            {children}
          </TransactionSigningProvider>
        </AuthBootstrap>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
