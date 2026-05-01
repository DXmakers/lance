"use client";

import { ThemeProvider } from "next-themes";
import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";
<<<<<<< feat/job-search-ui
import { getQueryClient } from "@/lib/query-client";
import { TransactionSigningProvider } from "@/components/blockchain/transaction-signing-provider";
=======
>>>>>>> main

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
<<<<<<< feat/job-search-ui
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
=======
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="lance-theme"
    >
      <AuthBootstrap>{children}</AuthBootstrap>
    </ThemeProvider>
  </QueryClientProvider>
>>>>>>> main
  );
}
