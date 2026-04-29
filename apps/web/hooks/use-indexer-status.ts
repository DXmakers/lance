import { useQuery } from "@tanstack/react-query";

export interface IndexerStatus {
  status: string;
  in_sync: boolean;
  max_allowed_lag: number;
  last_processed_ledger: number;
  last_updated_at: string;
  error_count: number;
  total_events_processed: number;
  last_batch_events_processed: number;
  last_batch_rate_per_second: number;
  last_loop_duration_ms: number;
  last_rpc_latency_ms: number;
  rpc_retry_count: number;
  latest_network_ledger: number;
  ledger_lag: number;
  rpc: {
    url: string;
    reachable: boolean;
  };
}

const API =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NEXT_PUBLIC_E2E === "true" ? "" : "http://localhost:3001");

export function useIndexerStatus() {
  return useQuery<IndexerStatus>({
    queryKey: ["indexer-status"],
    queryFn: async () => {
      const resp = await fetch(`${API}/api/sync-status`);
      if (!resp.ok) {
        throw new Error("Failed to fetch indexer status");
      }
      return resp.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}
