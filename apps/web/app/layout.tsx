import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
