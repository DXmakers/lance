"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";
import { QueryProvider } from "@/providers/query-provider";

type ProvidersProps = {
  children: ReactNode;
};

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryProvider>
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";
import { getQueryClient } from "@/lib/query-client";

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
        <AuthBootstrap>{children}</AuthBootstrap>
      </ThemeProvider>
    </QueryProvider>
    </QueryClientProvider>
  );
}
