import { jwtMemory } from "@/lib/store/use-auth-store";

const API =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NEXT_PUBLIC_E2E === "true" ? "" : "http://localhost:3001");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = jwtMemory.get();

  const res = await fetch(`${API}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    const body = await res.text();
    let parsedMessage: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      parsedMessage = parsed.error;
    } catch {
      parsedMessage = undefined;
    }

    throw new Error(parsedMessage || body || `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    getChallenge: (address: string) =>
      request<{ token: string }>(`/v1/auth/challenge`, {
        method: "POST",
        body: JSON.stringify({ address }),
      }),
  },
  jobs: {
    list: () => request<Job[]>("/v1/jobs"),
    get: (id: string) => request<Job>(`/v1/jobs/${id}`),
    create: (body: CreateJobBody) =>
      request<Job>("/v1/jobs", { method: "POST", body: JSON.stringify(body) }),
    markFunded: (id: string, body: MarkFundedBody) =>
      request<Job>(`/v1/jobs/${id}/fund`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    milestones: (id: string) => request<MilestoneSummary[]>(`/v1/jobs/${id}/milestones`),
    milestoneStats: (id: string) =>
      request<MilestoneStats>(`/v1/jobs/${id}/milestones/stats`),
    getMilestone: (jobId: string, milestoneId: string) =>
      request<Milestone>(`/v1/jobs/${jobId}/milestones/${milestoneId}`),
    updateMilestone: (jobId: string, milestoneId: string, body: UpdateMilestoneBody) =>
      request<Milestone>(`/v1/jobs/${jobId}/milestones/${milestoneId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    submitMilestone: (jobId: string, milestoneId: string, freelancerAddress: string) =>
      request<Milestone>(`/v1/jobs/${jobId}/milestones/${milestoneId}/submit`, {
        method: "POST",
        body: JSON.stringify({ freelancer_address: freelancerAddress }),
      }),
    approveMilestone: (jobId: string, milestoneId: string, clientAddress: string) =>
      request<Milestone>(`/v1/jobs/${jobId}/milestones/${milestoneId}/approve`, {
        method: "POST",
        body: JSON.stringify({ client_address: clientAddress }),
      }),
    releaseMilestone: (id: string, milestoneId: string) =>
      request<Milestone>(`/v1/jobs/${id}/milestones/${milestoneId}/release`, {
        method: "POST",
      }),
    reopenMilestone: (jobId: string, milestoneId: string, clientAddress: string) =>
      request<Milestone>(`/v1/jobs/${jobId}/milestones/${milestoneId}/reopen`, {
        method: "POST",
        body: JSON.stringify({ client_address: clientAddress }),
      }),
    milestoneNotes: (jobId: string, milestoneId: string) =>
      request<MilestoneNote[]>(`/v1/jobs/${jobId}/milestones/${milestoneId}/notes`),
    addMilestoneNote: (jobId: string, milestoneId: string, body: AddMilestoneNoteBody) =>
      request<MilestoneNote>(`/v1/jobs/${jobId}/milestones/${milestoneId}/notes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    milestoneEvents: (jobId: string, milestoneId: string) =>
      request<MilestoneEvent[]>(`/v1/jobs/${jobId}/milestones/${milestoneId}/events`),
    deliverables: {
      list: (jobId: string) => request<Deliverable[]>(`/v1/jobs/${jobId}/deliverables`),
      submit: (jobId: string, body: SubmitDeliverableBody) =>
        request<Deliverable>(`/v1/jobs/${jobId}/deliverables`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
    dispute: {
      get: (jobId: string) => request<Dispute>(`/v1/jobs/${jobId}/dispute`),
      open: (jobId: string, body: { opened_by: string }) =>
        request<Dispute>(`/v1/jobs/${jobId}/dispute`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
  },
  bids: {
    list: (jobId: string) => request<Bid[]>(`/v1/jobs/${jobId}/bids`),
    create: (jobId: string, body: CreateBidBody) =>
      request<Bid>(`/v1/jobs/${jobId}/bids`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    accept: (jobId: string, bidId: string, body: AcceptBidBody) =>
      request<Job>(`/v1/jobs/${jobId}/bids/${bidId}/accept`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  disputes: {
    get: (id: string) => request<Dispute>(`/v1/disputes/${id}`),
    verdict: (id: string) => request<Verdict>(`/v1/disputes/${id}/verdict`),
    evidence: {
      list: (id: string) => request<Evidence[]>(`/v1/disputes/${id}/evidence`),
      submit: (id: string, body: EvidenceBody) =>
        request<Evidence>(`/v1/disputes/${id}/evidence`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
  },
  uploads: {
    pin: (file: File): Promise<{ cid: string; filename: string }> => {
      const form = new FormData();
      form.append("file", file);

      return fetch(`${API}/api/v1/uploads`, {
        method: "POST",
        body: form,
      }).then(async (res) => {
        if (!res.ok) {
          throw new Error(await res.text());
        }
        return res.json();
      });
    },
  },
  users: {
    getProfile: (address: string) =>
      request<PublicProfile>(`/v1/users/${address}/profile`),
    updateProfile: (address: string, walletAddress: string, body: UpdateProfileBody) =>
      request<PublicProfile>(`/v1/users/${address}/profile`, {
        method: "PUT",
        headers: {
          "x-wallet-address": walletAddress,
        },
        body: JSON.stringify(body),
      }),
  },
};

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
  memo?: string;
}

export interface MarkFundedBody {
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

export interface AcceptBidBody {
  client_address: string;
}

export interface Milestone {
  id: string;
  job_id: string;
  index: number;
  title: string;
  description: string;
  amount_usdc: number;
  /** pending | submitted | approved | released | disputed */
  status: string;
  tx_hash?: string;
  due_date?: string;
  submitted_at?: string;
  approved_at?: string;
  released_at?: string;
  updated_at: string;
}

/** Lightweight summary returned by the list endpoint. */
export interface MilestoneSummary {
  id: string;
  job_id: string;
  index: number;
  title: string;
  amount_usdc: number;
  status: string;
  due_date?: string;
  submitted_at?: string;
  released_at?: string;
  updated_at: string;
}

export interface MilestoneStats {
  total: number;
  pending: number;
  submitted: number;
  approved: number;
  released: number;
  disputed: number;
  total_budget_usdc: number;
  released_usdc: number;
  pending_usdc: number;
  /** 0–100 */
  completion_pct: number;
}

export interface UpdateMilestoneBody {
  title?: string;
  description?: string;
  /** ISO date string YYYY-MM-DD */
  due_date?: string;
}

export interface MilestoneNote {
  id: string;
  milestone_id: string;
  job_id: string;
  author_address: string;
  body: string;
  created_at: string;
}

export interface AddMilestoneNoteBody {
  author_address: string;
  body: string;
}

export interface MilestoneEvent {
  id: string;
  milestone_id: string;
  job_id: string;
  actor_address: string;
  /** submitted | approved | released | disputed | reopened */
  event_type: string;
  previous_status: string;
  new_status: string;
  tx_hash?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Deliverable {
  id: string;
  job_id: string;
  milestone_index: number;
  submitted_by: string;
  label: string;
  kind: string;
  url: string;
  file_hash?: string;
  created_at: string;
}

export interface SubmitDeliverableBody {
  submitted_by: string;
  label: string;
  kind: string;
  url: string;
  file_hash?: string;
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
  created_at: string;
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
  created_at: string;
}

export interface ProfileMetrics {
  total_jobs: number;
  completed_jobs: number;
  active_jobs: number;
  disputed_jobs: number;
  verified_volume_usdc: number;
  completion_rate: number;
  dispute_rate: number;
}

export interface ProfileJobLedgerEntry {
  job_id: string;
  title: string;
  budget_usdc: number;
  role: string;
  counterparty: string;
  status: string;
  completed_at: string;
}

export interface PublicProfile {
  address: string;
  display_name?: string;
  headline: string;
  bio: string;
  portfolio_links: string[];
  updated_at: string;
  metrics: ProfileMetrics;
  history: ProfileJobLedgerEntry[];
}

export interface UpdateProfileBody {
  display_name?: string;
  headline: string;
  bio: string;
  portfolio_links: string[];
}