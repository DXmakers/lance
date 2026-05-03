/**
 * Tests for job-registry.ts - XDR Builder functions
 *
 * Validates acceptBid (Issue #162) and other contract interactions
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  acceptBid,
  AcceptBidParams,
  AcceptBidResult,
  type LifecycleListener,
} from "./job-registry";

// Mock environment variables
beforeEach(() => {
  process.env.NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "TESTNET";
});

describe("acceptBid", () => {
  it("should throw error when clientAddress is missing", async () => {
    const params: AcceptBidParams = {
      jobId: BigInt(1),
      clientAddress: "",
      freelancerAddress: "GD...",
    };

    await expect(acceptBid(params)).rejects.toThrow(
      "clientAddress is required."
    );
  });

  it("should throw error when jobId is zero or negative", async () => {
    const params: AcceptBidParams = {
      jobId: 0n,
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      freelancerAddress: "GD...",
    };

    await expect(acceptBid(params)).rejects.toThrow(
      "jobId must be greater than zero."
    );
  });

  it("should throw error when freelancerAddress is missing", async () => {
    const params: AcceptBidParams = {
      jobId: 1n,
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      freelancerAddress: "",
    };

    await expect(acceptBid(params)).rejects.toThrow(
      "freelancerAddress is required."
    );
  });

  it("should return mock result when E2E environment is enabled", async () => {
    process.env.NEXT_PUBLIC_E2E = "true";

    const params: AcceptBidParams = {
      jobId: 1n,
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      freelancerAddress: "GD...",
    };

    const lifecycleSteps: string[] = [];
    const onStep: LifecycleListener = (step) => {
      lifecycleSteps.push(step);
    };

    const result: AcceptBidResult = await acceptBid(params, onStep);

    expect(result).toBeDefined();
    expect(result.txHash).toBe("FAKE_TX_HASH");
    expect(result.simulation).toBeDefined();
    expect(lifecycleSteps).toContain("building");
    expect(lifecycleSteps).toContain("simulating");
    expect(lifecycleSteps).toContain("signing");
    expect(lifecycleSteps).toContain("submitting");
    expect(lifecycleSteps).toContain("confirming");
    expect(lifecycleSteps).toContain("confirmed");

    delete process.env.NEXT_PUBLIC_E2E;
  });

  it("should throw error when JOB_REGISTRY_CONTRACT_ID is not configured", async () => {
    delete process.env.NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID;

    const params: AcceptBidParams = {
      jobId: 1n,
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      freelancerAddress: "GD...",
    };

    await expect(acceptBid(params)).rejects.toThrow(
      "NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured."
    );
  });

  it("should call lifecycle listener with correct sequence when mock enabled", async () => {
    process.env.NEXT_PUBLIC_E2E = "true";

    const params: AcceptBidParams = {
      jobId: 123n,
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      freelancerAddress: "GD...",
    };

    const steps: string[] = [];
    const onStep: LifecycleListener = (step) => {
      steps.push(step);
    };

    await acceptBid(params, onStep);

    expect(steps).toEqual([
      "building",
      "simulating",
      "signing",
      "submitting",
      "confirming",
      "confirmed",
    ]);

    delete process.env.NEXT_PUBLIC_E2E;
  });
});
