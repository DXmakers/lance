"use client";

import { ThemeProvider } from "next-themes";
import React from "react";
import { QueryClient, QueryClientProvider } from "@/lib/query-client";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="lance-theme"
      >
        <AuthBootstrap>{children}</AuthBootstrap>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
