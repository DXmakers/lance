"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge, JobStatus } from "./status-badge";
import { Separator } from "@/components/ui/separator";

interface BidCardProps {
  bidId: string;
  freelancerName: string;
  freelancerAvatar?: string;
  bidAmount: number;
  currency: string;
  deliveryTimeDays: number;
  status: JobStatus;
  proposalPreview: string;
  onAccept?: (bidId: string) => void;
  onReject?: (bidId: string) => void;
  onViewProfile?: (freelancerName: string) => void;
}

export function BidCard({
  bidId,
  freelancerName,
  freelancerAvatar,
  bidAmount,
  currency,
  deliveryTimeDays,
  status,
  proposalPreview,
  onAccept,
  onReject,
  onViewProfile,
}: BidCardProps) {
  return (
    <article className="w-full max-w-lg bg-zinc-950 border border-zinc-800 shadow-2xl backdrop-blur-xl rounded-xl transition-all duration-150 hover:border-zinc-700">
      <Card className="border-none bg-transparent rounded-xl shadow-none p-2 space-y-4">
        <CardHeader className="p-4 pb-0 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onViewProfile?.(freelancerName)}
              className="outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 rounded-full transition-all duration-150"
            >
              <Avatar className="h-10 w-10 border border-zinc-800">
                <AvatarImage src={freelancerAvatar} alt={freelancerName} />
                <AvatarFallback className="bg-zinc-900 text-zinc-300 font-medium">
                  {freelancerName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
            <div className="flex flex-col">
              <CardTitle
                className="text-base text-zinc-100 font-inter cursor-pointer hover:underline underline-offset-2"
                onClick={() => onViewProfile?.(freelancerName)}
              >
                {freelancerName}
              </CardTitle>
              <p className="text-sm text-zinc-500 font-inter tracking-tight">
                {deliveryTimeDays} days delivery
              </p>
            </div>
          </div>
          <StatusBadge status={status} className="shadow-none bg-zinc-900/40" />
        </CardHeader>

        <CardContent className="p-4 pt-0 space-y-4">
          <p className="text-sm text-zinc-300 font-inter leading-relaxed line-clamp-3">
            {proposalPreview}
          </p>
          <Separator className="bg-zinc-800/80" />
          <div className="flex justify-between items-end">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold font-inter">
                Bid Amount
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-bold text-zinc-100 tracking-tight font-geist">
                  {bidAmount.toLocaleString()}
                </span>
                <span className="text-sm text-zinc-400 font-medium font-geist">{currency}</span>
              </div>
            </div>
          </div>
        </CardContent>

        {status === "pending" && (
          <CardFooter className="p-4 pt-0 flex gap-3">
            <Button
              variant="outline"
              className="flex-1 bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all duration-150 h-10 rounded-lg font-medium"
              onClick={() => onReject?.(bidId)}
            >
              Decline
            </Button>
            <Button
              className="flex-1 bg-zinc-100 text-zinc-950 hover:bg-white transition-all duration-150 h-10 rounded-lg font-medium shadow-[0_0_15px_rgba(255,255,255,0.1)]"
              onClick={() => onAccept?.(bidId)}
            >
              Accept Bid
            </Button>
          </CardFooter>
        )}
      </Card>
    </article>
  );
}
