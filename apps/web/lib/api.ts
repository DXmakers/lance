const API =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NEXT_PUBLIC_E2E === "true" ? "" : "http://localhost:3001");
import { useAuthStore } from "./store/use-auth-store";
import type { ReputationMetrics } from "./reputation";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().user?.token;
  
  const res = await fetch(`${API}/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
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
      request<AuthChallengeResponse>(`/v1/auth/challenge`, {
        method: "POST",
        body: JSON.stringify({ address }),
      }),
    verify: (address: string, signature: string) =>
      request<AuthVerifyResponse>(`/v1/auth/verify`, {
        method: "POST",
        body: JSON.stringify({ address, signature }),
      }),
  },
  jobs: {
    list: () => request<Job[]>("/v1/jobs"),
    get: (id: string) => request<Job>(`/v1/jobs/${id}`),
    create: (body: CreateJobBody) =>
      request<Job>("/v1/jobs", { method: "POST", body: JSON.stringify(body) }),
    storeMetadata: (jobId: string, body: JobMetadata) =>
      request<MetadataUploadResponse>(`/v1/jobs/${jobId}/metadata`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    markFunded: (id: string, body: MarkFundedBody) =>
      request<Job>(`/v1/jobs/${id}/fund`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    milestones: (id: string) => request<Milestone[]>(`/v1/jobs/${id}/milestones`),
    releaseMilestone: (id: string, milestoneId: string) =>
      request<Milestone>(`/v1/jobs/${id}/milestones/${milestoneId}/release`, {
        method: "POST",
      }),
    milestoneEvents: (id: string, milestoneId: string) =>
      request<MilestoneEvent[]>(`/v1/jobs/${id}/milestones/${milestoneId}/events`),
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
    updateProfile: (address: string, body: UpdateProfileBody) =>
      request<PublicProfile>(`/v1/users/${address}/profile`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
  },
};

export const apiAdmin = {
  indexer: {
    restart: () =>
      request<{ ok: boolean; message: string }>("/v1/admin/indexer/restart", {
        method: "POST",
      }),
    rescan: (fromLedger?: number) =>
      request<{ ok: boolean; rescan_from_ledger: number }>("/v1/admin/indexer/rescan", {
        method: "POST",
        body: JSON.stringify({ from_ledger: fromLedger }),
      }),
  },
};

export const apiActivity = {
  list: ({
    jobId,
    userAddress,
    limit,
    offset,
  }: {
    jobId?: string;
    userAddress?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const params = new URLSearchParams();
    if (jobId) params.set("job_id", jobId);
    if (userAddress) params.set("user_address", userAddress);
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));

    const query = params.toString();
    return request<ActivityLog[]>(`/v1/activity/logs${query ? `?${query}` : ""}`);
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

export interface JobMetadata {
  job_id: string;
  title: string;
  description: string;
  budget_usdc: number;
  milestones: number;
  client_address: string;
  tags: string[];
  skills_required: string[];
  estimated_duration_days?: number | null;
}

export interface MetadataUploadResponse {
  cid: string;
  metadata_hash: string;
  job_id: string;
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
  freelancerReputation?: ReputationMetrics;
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
  amount_usdc: number;
  /** "pending" | "released" */
  status: string;
  tx_hash?: string;
  released_at?: string;
  /** Optional human-readable description of what this milestone covers. */
  description?: string;
  /** Optional ISO-8601 target completion date. */
  due_date?: string;
  /** ISO-8601 timestamp when the milestone was completed (released or dispute-resolved). */
  completed_at?: string;
}

export interface MilestoneEvent {
  id: string;
  milestone_id: string;
  job_id: string;
  /** "created" | "deliverable_submitted" | "released" | "disputed" */
  event_type: string;
  actor_address?: string;
  tx_hash?: string;
  note?: string;
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

export interface ActivityLog {
  id: string;
  user_address?: string | null;
  job_id?: string | null;
  event_type: string;
  level: string;
  details: Record<string, unknown> | string | null;
  created_at: string;
}

export interface AuthChallengeResponse {
  address: string;
  challenge: string;
}

export interface AuthVerifyResponse {
  address: string;
  token: string;
}
