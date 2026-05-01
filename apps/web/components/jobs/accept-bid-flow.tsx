"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Bid, type Job } from "@/lib/api";
import { AcceptBidModal } from "./accept-bid-modal";
import { toast } from "sonner";

interface AcceptBidFlowProps {
  job: Job;
  bids: Bid[];
  isClientOwner: boolean;
  onSuccess?: () => void;
  children: (props: {
    handleAcceptClick: (bidId: string) => void;
    acceptingBidId: string | null;
  }) => React.ReactNode;
}

export function AcceptBidFlow({
  job,
  bids,
  isClientOwner,
  onSuccess,
  children,
}: AcceptBidFlowProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedBidId, setSelectedBidId] = useState<string | null>(null);

  const selectedBid = bids.find((b) => b.id === selectedBidId) || null;

  const acceptMutation = useMutation({
    mutationFn: async (bidId: string) => {
      return api.bids.accept(job.id, bidId, {
        client_address: job.client_address,
      });
    },
    onSuccess: (updatedJob) => {
      toast.success("Bid accepted successfully!");
      queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      queryClient.invalidateQueries({ queryKey: ["bids", job.id] });
      
      setSelectedBidId(null);
      onSuccess?.();
      
      // Redirect to funding page as per backend logic
      router.push(`/jobs/${updatedJob.id}/fund`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to accept bid. Please try again.");
      setSelectedBidId(null);
    },
  });

  const handleAcceptClick = (bidId: string) => {
    if (!isClientOwner) {
      toast.error("Only the job owner can accept bids.");
      return;
    }
    setSelectedBidId(bidId);
  };

  const handleConfirm = () => {
    if (selectedBidId) {
      acceptMutation.mutate(selectedBidId);
    }
  };

  return (
    <>
      {children({
        handleAcceptClick,
        acceptingBidId: acceptMutation.isPending ? selectedBidId : null,
      })}

      <AcceptBidModal
        isOpen={!!selectedBidId && !acceptMutation.isSuccess}
        onClose={() => !acceptMutation.isPending && setSelectedBidId(null)}
        onConfirm={handleConfirm}
        bid={selectedBid}
        job={job}
        isPending={acceptMutation.isPending}
      />
    </>
  );
}