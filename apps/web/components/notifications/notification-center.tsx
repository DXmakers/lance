"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, LoaderCircle } from "lucide-react";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";
import { NotificationErrorBoundary } from "@/components/notifications/notification-error-boundary";

function statusTone(status: string): string {
  if (status === "success") return "bg-emerald-500";
  if (status === "pending") return "bg-amber-500";
  if (status === "warning") return "bg-orange-500";
  return "bg-indigo-500";
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, isLoading, isError, markAllRead } =
    useRealtimeNotifications();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open real-time notifications"
        aria-expanded={open}
        className="relative inline-flex items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 text-zinc-100 transition-opacity duration-150 hover:opacity-85"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold text-white">
            {Math.min(unreadCount, 9)}
          </span>
        ) : null}
      </button>

      {open ? (
        <NotificationErrorBoundary>
          <section
            aria-label="Real-time notifications"
            className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[92vw] rounded-xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-[0_20px_70px_-35px_rgba(79,70,229,0.6)] backdrop-blur"
          >
            <header className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">Notifications</h3>
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-opacity duration-150 hover:opacity-80"
              >
                <CheckCheck className="h-3.5 w-3.5 text-indigo-400" />
                Mark read
              </button>
            </header>

            {isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-800 p-3 text-xs text-zinc-300">
                <LoaderCircle className="h-4 w-4 animate-spin text-indigo-400" />
                Syncing updates...
              </div>
            ) : null}

            {!isLoading && !notifications.length ? (
              <p className="rounded-xl border border-zinc-800 p-3 text-xs text-zinc-400">
                No notifications yet.
              </p>
            ) : null}

            <ul className="max-h-80 space-y-2 overflow-auto pr-1">
              {notifications.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href ?? "#"}
                    className="block rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${statusTone(item.status)}`} />
                      <p className="text-xs font-medium text-zinc-100">{item.title}</p>
                    </div>
                    <p className="text-xs text-zinc-300">{item.message}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>

            {isError ? (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-zinc-900 p-2 text-xs text-amber-200">
                Live feed degraded. Showing fallback updates.
              </p>
            ) : null}
          </section>
        </NotificationErrorBoundary>
      ) : null}
    </div>
  );
}
