"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  buildJobNotifications,
  getNewItems,
  getUnreadCount,
  parseRealtimeNotifications,
  type RealtimeNotification,
} from "@/lib/notifications";
import { toast } from "@/lib/toast";

const POLL_MS = 15000;

async function fetchNotifications(): Promise<RealtimeNotification[]> {
  try {
    const raw = await fetch("/api/v1/notifications");
    if (raw.ok) {
      const payload = (await raw.json()) as unknown;
      return parseRealtimeNotifications(payload);
    }
  } catch {
    // Fall back to derived notifications from job state.
  }

  const jobs = await api.jobs.list();
  return buildJobNotifications(jobs);
}

export function useRealtimeNotifications() {
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["realtime-notifications"],
    queryFn: fetchNotifications,
    staleTime: 5000,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const notifications = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (!notifications.length) return;

    const incoming = getNewItems(knownIdsRef.current, notifications);
    if (knownIdsRef.current.size > 0) {
      incoming.slice(0, 2).forEach((item) => {
        toast.info({
          title: item.title,
          description: item.message,
          duration: 3500,
        });
      });
    }

    knownIdsRef.current = new Set(notifications.map((item) => item.id));
  }, [notifications]);

  const enriched = useMemo(
    () => notifications.map((item) => ({ ...item, read: seenIds.has(item.id) })),
    [notifications, seenIds],
  );

  const unreadCount = useMemo(() => getUnreadCount(enriched), [enriched]);

  const markAllRead = () => {
    setSeenIds(new Set(notifications.map((item) => item.id)));
  };

  return {
    notifications: enriched,
    unreadCount,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh: query.refetch,
    markAllRead,
  };
}
