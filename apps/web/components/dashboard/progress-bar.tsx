"use client";

/**
 * ProgressBar - Animated progress indicator with shimmer effect
 * 
 * Features:
 * - Smooth width transitions
 * - Shimmer animation
 * - Emerald gradient fill
 * - Percentage display
 */

export interface ProgressBarProps {
  value: number;
  max?: number;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2",
  lg: "h-3",
};

export function ProgressBar({
  value,
  max = 100,
  showPercentage = false,
  size = "md",
  className = "",
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className={`space-y-1 ${className}`}>
      {showPercentage && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400">Progress</span>
          <span className="text-financial text-emerald-400">
            {percentage.toFixed(0)}%
          </span>
        </div>
      )}
      <div className={`progress-bar ${sizeClasses[size]}`}>
        <div
          className="progress-bar-fill"
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
}
