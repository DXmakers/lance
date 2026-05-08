"use client";

/**
 * GlassCard - Glassmorphic card component with backdrop blur
 * 
 * Features:
 * - Semi-transparent zinc-900/800 background
 * - Backdrop blur effect
 * - 12px border radius
 * - Optional hover effects
 * - Responsive padding
 */

import { ReactNode } from "react";

export interface GlassCardProps {
  children: ReactNode;
  elevated?: boolean;
  interactive?: boolean;
  className?: string;
  onClick?: () => void;
}

export function GlassCard({
  children,
  elevated = false,
  interactive = false,
  className = "",
  onClick,
}: GlassCardProps) {
  const baseClass = elevated ? "glass-card-elevated" : "glass-card";
  const interactiveClass = interactive ? "card-interactive" : "";

  return (
    <div
      className={`
        ${baseClass}
        ${interactiveClass}
        ${className}
        p-6
      `}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
    </div>
  );
}
