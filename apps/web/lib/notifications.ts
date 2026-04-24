import { z } from "zod";
import type { Job } from "@/lib/api";

export const NotificationStatusSchema = z.enum(["success", "pending", "warning", "info"]);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const RealtimeNotificationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
  status: NotificationStatusSchema,
  createdAt: z.string().min(1),
  href: z.string().optional(),
  read: z.boolean().default(false),
});

export type RealtimeNotification = z.infer<typeof RealtimeNotificationSchema>;

export function parseRealtimeNotifications(data: unknown): RealtimeNotification[] {
  return z.array(RealtimeNotificationSchema).parse(data);
}

function mapJobStatus(status: string): NotificationStatus {
  if (status === "funded" || status === "in_progress") return "success";
  if (status === "awaiting_funding" || status === "deliverable_submitted") return "pending";
  if (status === "disputed") return "warning";
  return "info";
}

export function buildJobNotifications(jobs: Job[]): RealtimeNotification[] {
  return [...jobs]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 12)
    .map((job) => ({
      id: `job:${job.id}:${job.updated_at}`,
      title: job.title,
      message: `Job ${job.status.replaceAll("_", " ")}`,
      status: mapJobStatus(job.status),
      createdAt: job.updated_at,
      href: `/jobs/${job.id}`,
      read: false,
    }));
}

export function getUnreadCount(items: RealtimeNotification[]): number {
  return items.reduce((count, item) => count + (item.read ? 0 : 1), 0);
}

export function getNewItems(
  previousIds: Set<string>,
  nextItems: RealtimeNotification[],
): RealtimeNotification[] {
  return nextItems.filter((item) => !previousIds.has(item.id));
}
