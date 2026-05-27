"use client";

/**
 * SidebarNavigation - Glassmorphic sidebar with icon navigation
 * 
 * Features:
 * - Slim, glassmorphic design
 * - Clear iconography
 * - Active state indicators
 * - Smooth transitions
 */

import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Star,
  Wallet,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: number;
}

export interface SidebarNavigationProps {
  activeItem?: string;
  onNavigate?: (itemId: string) => void;
  className?: string;
}

const defaultNavItems: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    id: "contracts",
    label: "Active Contracts",
    icon: FileText,
    href: "/dashboard/contracts",
  },
  {
    id: "reputation",
    label: "Reputation",
    icon: Star,
    href: "/dashboard/reputation",
  },
  {
    id: "finances",
    label: "Finances",
    icon: Wallet,
    href: "/dashboard/finances",
  },
];

export function SidebarNavigation({
  activeItem = "dashboard",
  onNavigate,
  className = "",
}: SidebarNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleNavigate = (itemId: string) => {
    onNavigate?.(itemId);
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden glass-card p-3"
        aria-label="Toggle menu"
      >
        {isOpen ? (
          <X className="h-5 w-5 text-zinc-100" />
        ) : (
          <Menu className="h-5 w-5 text-zinc-100" />
        )}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          glass-sidebar
          fixed lg:sticky
          top-0 left-0
          h-screen
          w-64
          flex flex-col
          transition-transform duration-300 ease-in-out
          z-40
          ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          ${className}
        `}
      >
        {/* Logo/Brand */}
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">F</span>
            </div>
            <div>
              <h1 className="text-zinc-100 font-semibold text-lg">Freelancer</h1>
              <p className="text-zinc-500 text-xs">Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4 space-y-1 custom-scrollbar overflow-y-auto">
          {defaultNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`nav-item w-full ${isActive ? "active" : ""}`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge && (
                  <span className="badge-warning text-[10px] px-2 py-0.5">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-zinc-800 space-y-1">
          <button className="nav-item w-full">
            <Settings className="h-5 w-5 flex-shrink-0" />
            <span className="flex-1 text-left">Settings</span>
          </button>
          <button className="nav-item w-full text-red-400 hover:text-red-300">
            <LogOut className="h-5 w-5 flex-shrink-0" />
            <span className="flex-1 text-left">Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
