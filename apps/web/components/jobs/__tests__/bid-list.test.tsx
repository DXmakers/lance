import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BidList } from "../bid-list";

const bids = [
  {
    id: "bid-1",
    job_id: "job-123",
    freelancer_address: "GABCD1234ABCDEFGHIJKLMN",
    proposal: "I will deliver this in three milestone stages.",
    status: "pending",
    created_at: "2026-04-28T00:00:00Z",
    freelancerReputation: {
      scoreBps: 3500,
      totalJobs: 4,
      totalPoints: 18,
      reviews: 4,
      starRating: 3.5,
      averageStars: 4.5,
    },
  },
  {
    id: "bid-2",
    job_id: "job-123",
    freelancer_address: "GZXYW9876ABCDEFGHIJKLMN",
    proposal: "I can ship a tighter timeline with stronger on-chain guarantees.",
    status: "pending",
    created_at: "2026-04-28T00:02:00Z",
    freelancerReputation: {
      scoreBps: 7600,
      totalJobs: 12,
      totalPoints: 52,
      reviews: 12,
      starRating: 4.7,
      averageStars: 4.3,
    },
  },
];

describe("BidList", () => {
  it("sorts active bids by freelancer reputation and shows score badges", () => {
    render(
      <BidList
        bids={bids}
        loading={false}
        error={null}
        isClientOwner={true}
        jobStatus="open"
        acceptingBidId={null}
        onAccept={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("GZXYW9876");
    expect(rows[1]).toHaveTextContent("12 jobs");
    expect(rows[2]).toHaveTextContent("GABCD1234");
    expect(rows[2]).toHaveTextContent("4 jobs");
  });

  it("shows accept actions for the client owner", () => {
    render(
      <BidList
        bids={bids}
        loading={false}
        error={null}
        isClientOwner={true}
        jobStatus="open"
        acceptingBidId={null}
        onAccept={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Accept bid from GZXYW9876/,
      }),
    ).toBeInTheDocument();
  });

  it("hides accept actions from unrelated viewers", () => {
    render(
      <BidList
        bids={bids}
        loading={false}
        error={null}
        isClientOwner={false}
        jobStatus="open"
        acceptingBidId={null}
      />,
    );

    expect(screen.queryByRole("button", { name: /Accept bid from/ })).not.toBeInTheDocument();
  });
});
