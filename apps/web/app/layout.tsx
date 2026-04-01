import type { Metadata } from "next";
import "./globals.css";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Providers } from "@/components/providers";
import { ToastProvider } from "@/components/ui/toast-provider";

export const metadata: Metadata = {
  title: "Lance | Soroban Freelance Intelligence",
  description:
    "Soroban-native freelance operations with escrow, reputation, and dispute intelligence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <Providers>
          <ToastProvider>
            <DashboardLayout>{children}</DashboardLayout>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}

