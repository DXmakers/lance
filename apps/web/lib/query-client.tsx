"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export class QueryClient {}

const QueryClientContext = createContext<QueryClient | null>(null);

export function QueryClientProvider({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <QueryClientContext.Provider value={client}>
      {children}
    </QueryClientContext.Provider>
  );
}

export function useQuery<TData>({
  queryFn,
  queryKey,
}: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<TData>;
  staleTime?: number;
}) {
  useContext(QueryClientContext);

  const [data, setData] = useState<TData | undefined>();
  const [error, setError] = useState<Error | null>(null);

  // starts loading immediately — no need to set it inside useEffect
  const [isLoading, setIsLoading] = useState(true);

  const key = useMemo(() => JSON.stringify(queryKey), [queryKey]);

  useEffect(() => {
    let mounted = true;

    queryFn()
      .then((result) => {
        if (!mounted) return;
        setData(result);
        setError(null);
      })
      .catch((queryError: unknown) => {
        if (!mounted) return;
        setError(
          queryError instanceof Error
            ? queryError
            : new Error("Query failed"),
        );
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [queryFn, key]);

  return { data, error, isLoading };
}

export function useMutation<TVariables>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (variables: TVariables) => Promise<unknown>;
  onSuccess?: () => Promise<void> | void;
}) {
  useContext(QueryClientContext);

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const mutationFnRef = useRef(mutationFn);
  mutationFnRef.current = mutationFn;

  async function mutateAsync(variables: TVariables) {
    setIsPending(true);
    setError(null);
    setIsSuccess(false);

    try {
      await mutationFnRef.current(variables);
      setIsSuccess(true);
      await onSuccess?.();
    } catch (mutationError) {
      const normalized =
        mutationError instanceof Error
          ? mutationError
          : new Error("Mutation failed");

      setError(normalized);
      throw normalized;
    } finally {
      setIsPending(false);
    }
  }

  function mutate(variables: TVariables) {
    void mutateAsync(variables);
  }

  return { mutate, mutateAsync, isPending, error, isSuccess };
}
