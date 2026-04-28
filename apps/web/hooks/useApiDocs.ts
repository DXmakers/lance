import { useQuery } from "@tanstack/react-query";
import { ApiEndpoint, MOCK_API_DOCS } from "../lib/docs-api";

/**
 * Hook to fetch all API endpoint documentation.
 * Uses TanStack Query for caching and stale-while-revalidate behavior.
 */
export function useApiDocs() {
  return useQuery<ApiEndpoint[]>({
    queryKey: ["api-docs"],
    queryFn: async () => {
      // Simulate API delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      return MOCK_API_DOCS;
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

/**
 * Hook to fetch a single API endpoint by ID.
 */
export function useApiEndpoint(id: string) {
  const { data: docs, ...rest } = useApiDocs();
  const endpoint = docs?.find((e) => e.id === id);
  
  return {
    data: endpoint,
    ...rest,
  };
}
