/**
 * XDR Builder for job_registry.post_job
 *
 * Constructs, simulates, signs, submits, and confirms Soroban
 * transactions for the Job Registry smart contract.
 *
 * Pipeline: Build → Simulate → Sign → Submit → Confirm
 *
 * Features:
 *  - Dynamic fee & resource adjustment from simulation results
 *  - Sequence-number mismatch detection with automatic retry
 *  - Dev-mode logging of raw XDR and simulation diagnostics
 *  - Configurable RPC polling with ledger-based timeout
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  Server as SorobanServer,
  Api,
} from "@stellar/stellar-sdk/rpc";
import { signTransaction } from "./stellar";

// ─── Configuration ──────────────────────────────────────────────────────────

const JOB_REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID ?? "";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_RETRIES = 30;
const SEQ_MISMATCH_MAX_RETRIES = 2;
const FEE_MARGIN_BPS = 200; // 2 % safety margin on top of simulated fee

const IS_DEV = process.env.NODE_ENV !== "production";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Each step the transaction lifecycle can be in. */
export type TxLifecycleStep =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "failed";

export interface SimulationResult {
  /** Estimated transaction fee (stroops). */
  fee: string;
  /** CPU instructions consumed. */
  cpuInstructions: string;
  /** Memory bytes consumed. */
  memoryBytes: string;
  /** Ledger read bytes. */
  readBytes?: number;
  /** Ledger write bytes. */
  writeBytes?: number;
  /** Raw simulation response for dev logging. */
  raw?: unknown;
}

export interface PostJobParams {
  /** On-chain job id (u64). Use 0 for auto-allocation via post_job_auto. */
  jobId: bigint;
  /** Client Stellar address – must match connected wallet. */
  clientAddress: string;
  /** Metadata hash (CID bytes) to store on-chain. */
  metadataHash: string;
  /** Budget in stroops (1 USDC = 10_000_000 stroops). */
  budgetStroops: bigint;
}

export interface PostJobResult {
  /** On-chain transaction hash. */
  txHash: string;
  /** Simulation diagnostics (available even after completion). */
  simulation: SimulationResult;
}

export interface SubmitBidParams {
  /** On-chain job id (u64). */
  jobId: bigint;
  /** Freelancer Stellar address – must match connected wallet. */
  freelancerAddress: string;
  /** Proposal hash (CID bytes) to store on-chain. */
  proposalHash: string;
}

export interface SubmitBidResult {
  /** On-chain transaction hash. */
  txHash: string;
  /** Simulation diagnostics. */
  simulation: SimulationResult;
}

export interface AcceptBidParams {
  /** On-chain job id (u64). */
  jobId: bigint;
  /** Client Stellar address - must match connected wallet. */
  clientAddress: string;
  /** Freelancer Stellar address of the submitted bid to accept. */
  freelancerAddress: string;
}

export interface AcceptBidResult {
  /** On-chain transaction hash. */
  txHash: string;
  /** Simulation diagnostics. */
  simulation: SimulationResult;
}

export interface LifecycleMetadata {
  rawXdr?: string;
}

export type LifecycleListener = (
  step: TxLifecycleStep,
  detail?: string,
  metadata?: LifecycleMetadata,
) => void;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shouldMockCalls(): boolean {
  if (process.env.NEXT_PUBLIC_E2E === "true") return true;
  if (!IS_DEV) return false;
  if (!JOB_REGISTRY_CONTRACT_ID) return true;
  return false;
}

/** Encode a UTF-8 string as an ScVal bytes value. */
function metadataHashToScVal(hash: string): xdr.ScVal {
  const bytes = new TextEncoder().encode(hash);
  return nativeToScVal(bytes, { type: "bytes" });
}

/** Compute fee with safety margin from simulation. */
function adjustedFee(simulatedFee: string): string {
  const base = BigInt(simulatedFee);
  const margin = (base * BigInt(FEE_MARGIN_BPS)) / 10_000n;
  return (base + margin).toString();
}

// ─── Dev-mode logger ─────────────────────────────────────────────────────────

function devLog(label: string, payload: unknown) {
  if (!IS_DEV) return;
  console.log(`[job-registry][${label}]`, payload);
}

// ─── Core Pipeline ───────────────────────────────────────────────────────────

/**
 * Full lifecycle: Build → Simulate → Sign → Submit → Confirm
 *
 * @param params  Post job arguments.
 * @param onStep  Callback for each lifecycle step change.
 * @returns       Confirmed transaction hash + simulation diagnostics.
 */
export async function postJob(
  params: PostJobParams,
  onStep?: LifecycleListener,
): Promise<PostJobResult> {
  if (shouldMockCalls()) {
    onStep?.("building", "mock");
    onStep?.("simulating", "mock");
    onStep?.("signing", "mock");
    onStep?.("submitting", "mock");
    onStep?.("confirming", "mock");
    onStep?.("confirmed", "mock");
    return {
      txHash: "FAKE_TX_HASH",
      simulation: {
        fee: "100",
        cpuInstructions: "0",
        memoryBytes: "0",
      },
    };
  }

  if (!JOB_REGISTRY_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured.");
  }

  const { jobId, clientAddress, metadataHash, budgetStroops } = params;

  // ── Parameter validation ────────────────────────────────────────────────
  if (!clientAddress) {
    throw new Error("clientAddress is required.");
  }
  if (!metadataHash || metadataHash.length === 0) {
    throw new Error("metadataHash must be a non-empty string.");
  }
  if (metadataHash.length > 96) {
    throw new Error("metadataHash exceeds maximum length of 96 bytes.");
  }
  if (budgetStroops <= 0n) {
    throw new Error("budgetStroops must be greater than zero.");
  }

  // Determine which contract method to invoke
  const isAuto = jobId === 0n;
  const method = isAuto ? "post_job_auto" : "post_job";

  // Build ScVal arguments
  const args: xdr.ScVal[] = isAuto
    ? [
        Address.fromString(clientAddress).toScVal(),
        metadataHashToScVal(metadataHash),
        nativeToScVal(budgetStroops, { type: "i128" }),
      ]
    : [
        nativeToScVal(jobId, { type: "u64" }),
        Address.fromString(clientAddress).toScVal(),
        metadataHashToScVal(metadataHash),
        nativeToScVal(budgetStroops, { type: "i128" }),
      ];

  return invokeJobRegistry(clientAddress, method, args, onStep);
}

/**
 * Full lifecycle: Build → Simulate → Sign → Submit → Confirm for submitting a bid.
 *
 * @param params  Submit bid arguments.
 * @param onStep  Callback for each lifecycle step change.
 * @returns       Confirmed transaction hash + simulation diagnostics.
 */
export async function submitBid(
  params: SubmitBidParams,
  onStep?: LifecycleListener,
): Promise<SubmitBidResult> {
  if (shouldMockCalls()) {
    onStep?.("building", "mock");
    onStep?.("simulating", "mock");
    onStep?.("signing", "mock");
    onStep?.("submitting", "mock");
    onStep?.("confirming", "mock");
    onStep?.("confirmed", "mock");
    return {
      txHash: "FAKE_TX_HASH",
      simulation: {
        fee: "100",
        cpuInstructions: "0",
        memoryBytes: "0",
      },
    };
  }

  if (!JOB_REGISTRY_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured.");
  }

  const { jobId, freelancerAddress, proposalHash } = params;

  // ── Parameter validation ────────────────────────────────────────────────
  if (!freelancerAddress) {
    throw new Error("freelancerAddress is required.");
  }
  if (!proposalHash || proposalHash.length === 0) {
    throw new Error("proposalHash must be a non-empty string.");
  }

  // Build ScVal arguments for submit_bid(job_id, freelancer, proposal_hash)
  const args: xdr.ScVal[] = [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(freelancerAddress).toScVal(),
    metadataHashToScVal(proposalHash),
  ];

  return invokeJobRegistry(freelancerAddress, "submit_bid", args, onStep);
}

/**
 * Full lifecycle: Build to Simulate to Sign to Submit to Confirm for accepting a bid.
 *
 * @param params  Accept bid arguments.
 * @param onStep  Callback for each lifecycle step change.
 * @returns       Confirmed transaction hash + simulation diagnostics.
 */
export async function acceptBid(
  params: AcceptBidParams,
  onStep?: LifecycleListener,
): Promise<AcceptBidResult> {
  if (shouldMockCalls()) {
    onStep?.("building", "mock");
    onStep?.("simulating", "mock");
    onStep?.("signing", "mock");
    onStep?.("submitting", "mock");
    onStep?.("confirming", "mock");
    onStep?.("confirmed", "mock");
    return {
      txHash: "FAKE_TX_HASH",
      simulation: {
        fee: "100",
        cpuInstructions: "0",
        memoryBytes: "0",
      },
    };
  }

  if (!JOB_REGISTRY_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured.");
  }

  const { jobId, clientAddress, freelancerAddress } = params;

  // ── Parameter validation ────────────────────────────────────────────────────
  if (!clientAddress) {
    throw new Error("clientAddress is required.");
  }
  if (jobId <= 0n) {
    throw new Error("jobId must be greater than zero.");
  }
  if (!freelancerAddress) {
    throw new Error("freelancerAddress is required.");
  }

  // Build ScVal arguments for accept_bid(job_id, client, freelancer)
  const args: xdr.ScVal[] = [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(clientAddress).toScVal(),
    Address.fromString(freelancerAddress).toScVal(),
  ];

  return invokeJobRegistry(clientAddress, "accept_bid", args, onStep);
}

/**
 * Core Soroban invocation pipeline with:
 *   - Simulation-first with fee & resource adjustment
 *   - Sequence-number mismatch retry
 *   - Detailed dev-mode logging
 *   - Ledger-based confirmation polling
 */
async function invokeJobRegistry(
  callerAddress: string,
  method: string,
  args: xdr.ScVal[],
  onStep?: LifecycleListener,
): Promise<PostJobResult> {
  const rpc = new SorobanServer(RPC_URL);
  const contract = new Contract(JOB_REGISTRY_CONTRACT_ID);

  let simulation: SimulationResult | null = null;
  let lastError: Error | null = null;

  for (let seqRetry = 0; seqRetry <= SEQ_MISMATCH_MAX_RETRIES; seqRetry++) {
    try {
      // ── Step 1: Build ──────────────────────────────────────────────────
      onStep?.("building");
      const account = await rpc.getAccount(callerAddress);
      devLog("source-account", { address: callerAddress, sequence: account.sequenceNumber() });

      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      }).addOperation(contract.call(method, ...args));

      const tx = txBuilder.setTimeout(30).build();

      const rawBuildXdr = tx.toXDR();
      devLog("raw-build-xdr", rawBuildXdr);
      onStep?.("building", undefined, { rawXdr: rawBuildXdr });

      // ── Step 2: Simulate ──────────────────────────────────────────────
      onStep?.("simulating");
      const simResult = await rpc.simulateTransaction(tx);
      devLog("simulation-response", simResult);

      if (Api.isSimulationError(simResult)) {
        throw new Error(
          `Simulation failed: ${simResult.error}`,
        );
      }

      // Extract resource metrics from successful simulation
      const simSuccess = simResult as Api.SimulateTransactionSuccessResponse;
      
      // Access cost and transaction data resources defensively to satisfy both 
      // the compiler and ESLint without using 'any'.
      const simData = simSuccess as unknown as { 
        cost?: { cpuInsns?: string; memBytes?: string };
        transactionData?: { 
          resources?: () => { 
            readBytes: () => number; 
            writeBytes: () => number 
          } 
        };
      };

      const cost = simData.cost || {};
      const resources = simData.transactionData?.resources?.();

      simulation = {
        fee: simSuccess.minResourceFee ?? BASE_FEE,
        cpuInstructions: cost.cpuInsns ?? "0",
        memoryBytes: cost.memBytes ?? "0",
        readBytes: resources?.readBytes() ?? 0,
        writeBytes: resources?.writeBytes() ?? 0,
        raw: IS_DEV ? simResult : undefined,
      };

      // Apply dynamic fee adjustment based on simulation
      const finalFee = adjustedFee(simulation.fee);
      devLog("fee-adjustment", {
        simulatedFee: simulation.fee,
        adjustedFee: finalFee,
        marginBps: FEE_MARGIN_BPS,
      });

      // Prepare the transaction with simulation data
      const prepared = await rpc.prepareTransaction(tx);
      const preparedXdr = prepared.toXDR();
      devLog("prepared-xdr", preparedXdr);
      onStep?.("simulating", undefined, { rawXdr: preparedXdr });

      // ── Step 3: Sign ──────────────────────────────────────────────────
      onStep?.("signing", undefined, { rawXdr: preparedXdr });
      const signedXdr = await signTransaction(preparedXdr);
      const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
      devLog("signed-xdr", signedXdr);
      onStep?.("signing", undefined, { rawXdr: signedXdr });

      // ── Step 4: Submit ────────────────────────────────────────────────
      onStep?.("submitting");
      const sendResult = await rpc.sendTransaction(signedTx);
      devLog("send-result", sendResult);

      if (sendResult.status === "ERROR") {
        // Precise sequence mismatch detection via result XDR if available
        let isSeqMismatch = false;
        try {
          if (sendResult.errorResult) {
            isSeqMismatch = sendResult.errorResult.result().switch().name === 'txBadSeq';
          }
        } catch {
          // Fallback to string matching if XDR parsing fails
        }

        if (isSeqMismatch) {
          throw new Error("SEQUENCE_NUMBER_MISMATCH");
        }

        throw new Error(
          `Transaction submission failed: ${JSON.stringify(sendResult.errorResult ?? "unknown error")}`,
        );
      }

      const txHash = sendResult.hash;
      devLog("tx-hash", txHash);

      // ── Step 5: Confirm ───────────────────────────────────────────────
      onStep?.("confirming", txHash);
      for (let i = 0; i < POLL_MAX_RETRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const result = await rpc.getTransaction(txHash);
        devLog("poll-result", { attempt: i + 1, status: result.status });

        if (result.status === Api.GetTransactionStatus.SUCCESS) {
          onStep?.("confirmed", txHash);
          return {
            txHash,
            simulation: simulation!,
          };
        }
        if (result.status === Api.GetTransactionStatus.FAILED) {
          const detail = result.resultXdr ? result.resultXdr.toXDR("base64") : "unknown failure";
          throw new Error(`Transaction failed on-chain (hash: ${txHash}): ${detail}`);
        }
        // NOT_FOUND → still pending, keep polling
      }

      throw new Error(
        `Confirmation timed out after ${POLL_MAX_RETRIES * (POLL_INTERVAL_MS / 1_000)}s (hash: ${txHash})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Detect sequence number mismatch → retry with fresh account
      if (
        message.includes("tx_bad_seq") ||
        message.includes("Sequence Number Mismatch") ||
        message.includes("SEQUENCE_NUMBER_MISMATCH") ||
        message.includes("bad_seq")
      ) {
        lastError = err instanceof Error ? err : new Error(message);
        devLog("seq-mismatch-retry", {
          attempt: seqRetry + 1,
          max: SEQ_MISMATCH_MAX_RETRIES,
        });
        // Brief pause before retry
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Non-retryable error
      onStep?.("failed", message);
      throw err;
    }
  }

  // Exhausted retries for sequence mismatch
  onStep?.("failed", lastError?.message);
  throw lastError ?? new Error("Transaction failed after sequence mismatch retries.");
}

/**
 * Convenience: calls post_job_auto – the contract allocates the next job id.
 */
export async function postJobAuto(
  clientAddress: string,
  metadataHash: string,
  budgetStroops: bigint,
  onStep?: LifecycleListener,
): Promise<PostJobResult> {
  return postJob(
    { jobId: 0n, clientAddress, metadataHash, budgetStroops },
    onStep,
  );
}
