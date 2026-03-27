"use client";

import React, { useState } from "react";
import { TopNav } from "@/components/navigation/top-nav";
import { Sidebar } from "@/components/navigation/sidebar";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <TopNav onOpenSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      
      <div className="flex flex-1">
        <Sidebar className={cn(
          "fixed inset-y-16 left-0 z-30 transition-transform md:sticky md:block",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )} />
        
        {/* Mobile Sidebar Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 z-20 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <main className="flex-1 overflow-x-hidden p-6 md:p-10 lg:p-12">
          <div className="mx-auto max-w-7xl animate-in fade-in slide-in-from-bottom-2 duration-700">
            {children}
          </div>
        </main>
      </div>
      
      {/* Background Decorator */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-10">
        <div className="absolute -left-1/4 top-1/4 h-[500px] w-[500px] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -right-1/4 bottom-1/4 h-[400px] w-[400px] rounded-full bg-indigo-500/20 blur-[100px]" />
      </div>
    </div>
  );
}
