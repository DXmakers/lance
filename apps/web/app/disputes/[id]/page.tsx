"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import { api } from "@/lib/api";

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    let active = true;

    void api.disputes
      .get(id)
      .then((dispute) => {
        if (!active) return;
        router.replace(`/jobs/${dispute.job_id}/dispute?disputeId=${dispute.id}`);
      })
      .catch(() => {
        if (!active) return;
      });

    return () => {
      active = false;
    };
  }, [id, router]);

  return (
    <SiteShell
      eyebrow="Dispute Center"
      title="Redirecting to job-linked dispute center"
      description="Legacy dispute URLs now resolve to the canonical job-based route."
    >
      <div className="h-64 animate-pulse rounded-[2rem] border border-slate-200 bg-white/70" />
    </SiteShell>
  );
}
