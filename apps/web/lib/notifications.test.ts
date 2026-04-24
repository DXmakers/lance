import {
  buildJobNotifications,
  getNewItems,
  getUnreadCount,
  parseRealtimeNotifications,
} from "@/lib/notifications";
import type { Job } from "@/lib/api";

describe("notifications utils", () => {
  const baseJob: Job = {
    id: "job_1",
    title: "Escrow setup",
    description: "setup",
    budget_usdc: 100,
    milestones: 2,
    client_address: "GCLIENT",
    status: "deliverable_submitted",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };

  it("builds notification status from job status", () => {
    const items = buildJobNotifications([
      baseJob,
      { ...baseJob, id: "job_2", status: "funded", updated_at: "2026-01-03T00:00:00.000Z" },
      { ...baseJob, id: "job_3", status: "disputed", updated_at: "2026-01-04T00:00:00.000Z" },
    ]);

    expect(items[0].status).toBe("warning");
    expect(items[1].status).toBe("success");
    expect(items[2].status).toBe("pending");
  });

  it("parses realtime payload with zod", () => {
    const parsed = parseRealtimeNotifications([
      {
        id: "n1",
        title: "Milestone released",
        message: "Milestone 1 released",
        status: "success",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].read).toBe(false);
  });

  it("computes unread and new ids", () => {
    const items = [
      {
        id: "a",
        title: "A",
        message: "A",
        status: "info" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        read: false,
      },
      {
        id: "b",
        title: "B",
        message: "B",
        status: "info" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        read: true,
      },
    ];

    expect(getUnreadCount(items)).toBe(1);
    expect(getNewItems(new Set(["a"]), items).map((item) => item.id)).toEqual(["b"]);
  });
});
