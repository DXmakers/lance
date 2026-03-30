import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { ToastProvider } from "@/components/ui/toast-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Lance - Decentralized Freelance Marketplace",
  description: "Stellar-native freelance marketplace with AI-powered dispute resolution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WalletProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
          <Toaster position="bottom-right" richColors />
        </WalletProvider>
      <body className="antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
