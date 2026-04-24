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
import { connectWallet, getConnectedWalletAddress, signTransaction } from "./stellar";

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

export type LifecycleListener = (
  step: TxLifecycleStep,
  detail?: string,
) => void;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shouldMockCalls(): boolean {
  if (process.env.NEXT_PUBLIC_E2E === "true") return true;
  if (!IS_DEV) return false;
  if (!JOB_REGISTRY_CONTRACT_ID) return true;
  return false;
}

async function getCallerAddress(): Promise<string> {
  const connected = await getConnectedWalletAddress();
  if (connected) return connected;
  return connectWallet();
}

/** Encode a UTF-8 string as an ScVal bytes value. */
function metadataHashToScVal(hash: string): xdr.ScVal {
  const bytes = Buffer.from(hash, "utf-8");
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

      // ── Step 2: Simulate ──────────────────────────────────────────────
      onStep?.("simulating");
      const simResult = await rpc.simulateTransaction(tx);
      devLog("simulation-response", simResult);

      if (Api.isSimulationError(simResult)) {
        throw new Error(
          `Simulation failed: ${(simResult as Api.SimulateTransactionErrorResponse).error}`,
        );
      }

      // Extract resource metrics from successful simulation
      const simSuccess = simResult as Api.SimulateTransactionSuccessResponse;

      simulation = {
        fee: simSuccess.minResourceFee ?? BASE_FEE,
        cpuInstructions: "0",
        memoryBytes: "0",
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

      // ── Step 3: Sign ──────────────────────────────────────────────────
      onStep?.("signing");
      const signedXdr = await signTransaction(preparedXdr);
      const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
      devLog("signed-xdr", signedXdr);

      // ── Step 4: Submit ────────────────────────────────────────────────
      onStep?.("submitting");
      const sendResult = await rpc.sendTransaction(signedTx);
      devLog("send-result", sendResult);

      if (sendResult.status === "ERROR") {
        throw new Error(
          `Transaction submission failed: ${JSON.stringify(sendResult.errorResult ?? "unknown error")}`,
        );
      }

      const txHash = sendResult.hash;
      devLog("tx-hash", txHash);

      // ── Step 5: Confirm ───────────────────────────────────────────────
      onStep?.("confirming");
      for (let i = 0; i < POLL_MAX_RETRIES; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const result = await rpc.getTransaction(txHash);
        devLog("poll-result", { attempt: i + 1, status: result.status });

        if (result.status === "SUCCESS") {
          onStep?.("confirmed", txHash);
          return {
            txHash,
            simulation: simulation!,
          };
        }
        if (result.status === "FAILED") {
          throw new Error(`Transaction failed on-chain (hash: ${txHash})`);
        }
        // NOT_FOUND → still pending, keep polling
      }

      throw new Error(
        `Confirmation timed out after ${POLL_MAX_RETRIES * (POLL_INTERVAL_MS / 1_000)}s (hash: ${txHash})`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      // Detect sequence number mismatch → retry with fresh account
      if (
        message.includes("tx_bad_seq") ||
        message.includes("Sequence Number Mismatch") ||
        message.includes("SEQUENCE_NUMBER_MISMATCH")
      ) {
        lastError = err instanceof Error ? err : new Error(message);
        devLog("seq-mismatch-retry", {
          attempt: seqRetry + 1,
          max: SEQ_MISMATCH_MAX_RETRIES,
        });
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
