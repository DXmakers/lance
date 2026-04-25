import React from "react";

export const JobSkeleton = () => {
  return (
    <div className="flex flex-col p-6 rounded-xl border border-white/5 bg-white/[0.02] animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex flex-col gap-2">
          <div className="h-4 w-16 bg-zinc-800 rounded" />
          <div className="h-6 w-48 bg-zinc-800 rounded mt-2" />
        </div>
        <div className="h-5 w-5 bg-zinc-800 rounded" />
      </div>

      <div className="space-y-2 mb-6">
        <div className="h-3 w-full bg-zinc-800 rounded" />
        <div className="h-3 w-2/3 bg-zinc-800 rounded" />
      </div>

      <div className="flex gap-2 mb-6">
        <div className="h-4 w-12 bg-zinc-800 rounded" />
        <div className="h-4 w-16 bg-zinc-800 rounded" />
        <div className="h-4 w-14 bg-zinc-800 rounded" />
      </div>

      <div className="mt-auto grid grid-cols-2 gap-4 p-4 rounded-lg bg-zinc-950/30 border border-zinc-800/30">
        <div className="space-y-2">
          <div className="h-2 w-10 bg-zinc-800 rounded" />
          <div className="h-4 w-16 bg-zinc-800 rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-2 w-10 bg-zinc-800 rounded" />
          <div className="h-4 w-16 bg-zinc-800 rounded" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-2 w-8 bg-zinc-800 rounded" />
          <div className="h-3 w-20 bg-zinc-800 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-12 bg-zinc-800 rounded" />
          <div className="h-4 w-8 bg-zinc-800 rounded" />
        </div>
      </div>
    </div>
  );
};
