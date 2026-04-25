"use client";

import React, { useState } from "react";
import * as z from "zod";
import { useMutation } from "@tanstack/react-query";
import { Copy, CheckCircle2, Share2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

// Basic schema for sharing via email
const shareJobSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export type ShareJobFormValues = z.infer<typeof shareJobSchema>;

interface ShareJobProps {
  jobId: string;
  jobTitle: string;
}

export function ShareJob({ jobId, jobTitle }: ShareJobProps) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/jobs/${jobId}`;

  const { mutate: shareViaEmail, isPending } = useMutation({
    mutationFn: async (data: ShareJobFormValues) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return data;
    },
    onSuccess: (data) => {
      toast.success("Job Shared!", {
        description: `An invitation was successfully sent to ${data.email}`,
      });
      setEmail("");
      setError(null);
    },
    onError: () => {
      toast.error("Error", {
        description: "We encountered a network fault trying to share the job.",
      });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = shareJobSchema.safeParse({ email });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    setError(null);
    shareViaEmail({ email: result.data.email });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="w-full max-w-md bg-zinc-950 border border-zinc-800/50 shadow-2xl backdrop-blur-xl rounded-xl">
      <CardHeader className="space-y-2 p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80">
            <Share2 className="w-5 h-5 text-zinc-300" />
          </div>
          <div>
            <CardTitle className="text-lg font-medium text-zinc-100 tracking-tight font-inter">
              Share Opportunity
            </CardTitle>
            <CardDescription className="text-sm text-zinc-400 font-inter">
              Invite talent directly to <span className="font-semibold text-zinc-300">{jobTitle}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-2 space-y-5">
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 relative">
            <Input
              readOnly
              value={shareUrl}
              className="bg-zinc-900/50 border-zinc-800 text-zinc-300 rounded-lg pr-4 font-geist text-sm h-10 w-full focus-visible:ring-1 focus-visible:ring-zinc-700 transition-all duration-150"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={copyToClipboard}
            className="shrink-0 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 h-10 px-4 rounded-lg flex items-center gap-2 transition-all duration-150"
          >
            {copied ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-zinc-800/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-zinc-950 px-2 text-zinc-500 tracking-wider">Or send via email</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
              <Input
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="colleague@domain.com"
                className="pl-9 h-10 bg-zinc-900/50 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 rounded-lg focus-visible:ring-1 focus-visible:ring-zinc-700 transition-all duration-150"
              />
            </div>
            {error && (
              <p className="text-[13px] text-red-500/90 font-medium tracking-tight">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-10 bg-zinc-100 hover:bg-white text-zinc-950 font-medium rounded-lg transition-all duration-150 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isPending ? "Sending Invitation..." : "Send Invitation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
