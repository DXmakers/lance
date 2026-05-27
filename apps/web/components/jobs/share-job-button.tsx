"use client";

import { type MouseEvent, useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

interface ShareJobButtonProps {
  path: string;
  title?: string;
  className?: string;
}

function getShareUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

export function ShareJobButton({
  path,
  title = "Lance job",
  className,
}: ShareJobButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(shareUrl: string) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is unavailable");
    }

    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    toast.success({
      title: "Link copied",
      description: "Job URL copied to your clipboard.",
    });
  }

  async function handleShare(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    const shareUrl = getShareUrl(path);

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: "Check out this freelance opportunity on Lance.",
          url: shareUrl,
        });
        toast.success({
          title: "Share ready",
          description: "Opened your share sheet.",
        });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
    }

    try {
      await copyToClipboard(shareUrl);
    } catch {
      toast.error({
        title: "Unable to share",
        description: "Your browser blocked sharing and clipboard access.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        void handleShare(event);
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-amber-300 hover:text-slate-900",
        className,
      )}
      aria-label="Share this job"
      title="Share this job"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Share"}
      <Link2 className="h-3.5 w-3.5 text-slate-400" />
    </button>
  );
}
