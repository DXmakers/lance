"use client";

/**
 * ReputationWidget - On-chain credentials and ratings display
 * 
 * Features:
 * - Overall rating with star visualization
 * - Completed projects count
 * - Success rate percentage
 * - Skill tags
 * - Technical, trust-building design
 */

import { Star, Award, CheckCircle2, TrendingUp } from "lucide-react";
import { GlassCard } from "./glass-card";

export interface ReputationData {
  rating: number;
  totalReviews: number;
  completedProjects: number;
  successRate: number;
  skills: string[];
  badges?: string[];
}

export interface ReputationWidgetProps {
  data: ReputationData;
  className?: string;
}

export function ReputationWidget({
  data,
  className = "",
}: ReputationWidgetProps) {
  const { rating, totalReviews, completedProjects, successRate, skills, badges } = data;

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < 5; i++) {
      if (i < fullStars) {
        stars.push(
          <Star
            key={i}
            className="h-5 w-5 fill-amber-400 text-amber-400"
          />
        );
      } else if (i === fullStars && hasHalfStar) {
        stars.push(
          <div key={i} className="relative">
            <Star className="h-5 w-5 text-zinc-700" />
            <div className="absolute inset-0 overflow-hidden w-1/2">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            </div>
          </div>
        );
      } else {
        stars.push(
          <Star key={i} className="h-5 w-5 text-zinc-700" />
        );
      }
    }

    return stars;
  };

  return (
    <GlassCard className={`animate-fade-in ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Award className="h-5 w-5 text-emerald-400" />
        <h2 className="text-zinc-100 font-semibold text-lg">Reputation</h2>
      </div>

      {/* Rating */}
      <div className="mb-6">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-financial text-4xl text-zinc-100">
            {rating.toFixed(1)}
          </span>
          <span className="text-zinc-500 text-sm">/ 5.0</span>
        </div>
        <div className="flex items-center gap-1 mb-1">
          {renderStars(rating)}
        </div>
        <p className="text-zinc-500 text-xs">
          Based on {totalReviews} {totalReviews === 1 ? "review" : "reviews"}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-zinc-800">
        {/* Completed Projects */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-zinc-400 text-xs">Completed</span>
          </div>
          <span className="text-financial text-2xl text-zinc-100">
            {completedProjects}
          </span>
        </div>

        {/* Success Rate */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="text-zinc-400 text-xs">Success Rate</span>
          </div>
          <span className="text-financial text-2xl text-emerald-400">
            {successRate}%
          </span>
        </div>
      </div>

      {/* Badges */}
      {badges && badges.length > 0 && (
        <div className="mb-6">
          <h3 className="text-zinc-400 text-xs font-medium mb-3">Achievements</h3>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge, index) => (
              <div
                key={index}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700"
              >
                <Award className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs text-zinc-300">{badge}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills */}
      <div>
        <h3 className="text-zinc-400 text-xs font-medium mb-3">Skills</h3>
        <div className="flex flex-wrap gap-2">
          {skills.map((skill, index) => (
            <span
              key={index}
              className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
