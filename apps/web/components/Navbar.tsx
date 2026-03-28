"use client";

import React from "react";
import Link from "next/link";
import { ConnectButton } from "./ConnectButton";

export const Navbar: React.FC = () => {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-xl font-bold tracking-tight text-black dark:text-white">
            Lance
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
};
