"use client";

import { ThemeProvider } from "next-themes";
import React from "react";
import { AuthBootstrap } from "@/components/state/auth-bootstrap";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <AuthBootstrap>{children}</AuthBootstrap>
    </ThemeProvider>
  );
}
