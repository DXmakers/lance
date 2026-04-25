import type { Metadata } from "next";
import "./globals.css";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Providers } from "@/components/providers";
import { ToastProvider } from "@/components/ui/toast-provider";

export const metadata: Metadata = {
  title: "Lance",
  description: "Mock-ready freelance platform flows for deterministic E2E testing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased font-sans">
        <Providers>
          <ToastProvider>
            <DashboardLayout>{children}</DashboardLayout>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}