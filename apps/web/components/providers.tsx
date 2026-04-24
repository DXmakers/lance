"use client";

import { ThemeProvider } from "next-themes";
import React from "react";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";
import { QueryProvider } from "@/providers/query-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
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
  );
}
