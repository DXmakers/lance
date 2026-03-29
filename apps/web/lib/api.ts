const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export const api = {
  jobs: {
    list: () => request<Job[]>("/v1/jobs"),
    get: (id: string) => request<Job>(`/v1/jobs/${id}`),
    create: (body: CreateJobBody) =>
      request<Job>("/v1/jobs", { method: "POST", body: JSON.stringify(body) }),
  },
  bids: {
    list: (jobId: string) => request<Bid[]>(`/v1/jobs/${jobId}/bids`),
    create: (jobId: string, body: CreateBidBody) =>
      request<Bid>(`/v1/jobs/${jobId}/bids`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  disputes: {
    open: (jobId: string, body: { opened_by: string }) =>
      request<Dispute>(`/v1/jobs/${jobId}/dispute`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    get: (id: string) => request<Dispute>(`/v1/disputes/${id}`),
    verdict: (id: string) => request<Verdict>(`/v1/disputes/${id}/verdict`),
    submitEvidence: (id: string, body: EvidenceBody) =>
      request<Evidence>(`/v1/disputes/${id}/evidence`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  uploads: {
    pin: (file: File): Promise<{ cid: string; filename: string }> => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${API}/api/v1/uploads`, { method: "POST", body: form }).then(
        async (res) => {
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        }
      );
    },
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  title: string;
  description: string;
  budget_usdc: number;
  milestones: number;
  client_address: string;
  freelancer_address?: string;
  status: string;
  metadata_hash?: string;
  on_chain_job_id?: number;
  created_at: string;
  updated_at: string;
}
export interface CreateJobBody {
  title: string;
  description: string;
  budget_usdc: number;
  milestones: number;
  client_address: string;
}
export interface Bid {
  id: string;
  job_id: string;
  freelancer_address: string;
  proposal: string;
  status: string;
  created_at: string;
}
export interface CreateBidBody {
  freelancer_address: string;
  proposal: string;
}
export interface Dispute {
  id: string;
  job_id: string;
  opened_by: string;
  status: string;
  created_at: string;
}
export interface Evidence {
  id: string;
  dispute_id: string;
  submitted_by: string;
  content: string;
  file_hash?: string;
}
export interface EvidenceBody {
  submitted_by: string;
  content: string;
  file_hash?: string;
}
export interface Verdict {
  id: string;
  dispute_id: string;
  winner: string;
  freelancer_share_bps: number;
  reasoning: string;
  on_chain_tx?: string;
}
