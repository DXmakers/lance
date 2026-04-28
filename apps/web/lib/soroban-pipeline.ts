/**
 * soroban-pipeline.ts
 *
 * Core 5-step Soroban transaction pipeline:
 *   Build → Simulate → Sign → Submit → Confirm (Poll)
 *
 * Features:
 *  - Dynamic resource/fee assembly from simulation results
 *  - Sequence-number-mismatch retry with account refresh
 *  - Raw XDR + simulation log exposure for dev environments
 *  - Typed step-by-step progress events for UI consumption
 */

import {
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Server as SorobanServer, Api } from "@stellar/stellar-sdk/rpc";
import { signTransaction, APP_STELLAR_NETWORK } from "./stellar";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_RETRIES = 30;
const MAX_SEQ_RETRIES = 3;

const IS_DEV = process.env.NODE_ENV !== "production";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelineStep =
  | "idle"
  | "building"
  | "simulating"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

export interface SimulationLog {
  /** Raw simulation response from the RPC (dev only) */
  raw?: Api.SimulateTransactionResponse;
  /** Classic transaction fee in stroops */
  baseFee: string;
  /** Soroban resource fee in stroops */
  resourceFee: string;
  /** Estimated total fee after simulation assembly */
  estimatedTotalFee: string;
  /** CPU instructions consumed */
  cpuInsns: string;
  /** Memory bytes consumed */
  memBytes: string;
  /** Ledger reads/writes */
  readBytes: number;
  writeBytes: number;
}

export interface PipelineResult {
  /** Confirmed transaction hash */
  txHash: string;
  /** Unsigned XDR (dev only) */
  unsignedXdr?: string;
  /** Signed XDR (dev only) */
  signedXdr?: string;
  /** Simulation diagnostics */
  simulationLog?: SimulationLog;
}

export interface PipelineProgressEvent {
  step: PipelineStep;
  /** Populated once the tx is submitted */
  txHash?: string;
  /** Populated after simulation */
  simulationLog?: SimulationLog;
  /** Populated after build (dev only) */
  unsignedXdr?: string;
  /** Populated after sign (dev only) */
  signedXdr?: string;
  /** Human-readable status message */
  message: string;
}

export type PipelineProgressCallback = (event: PipelineProgressEvent) => void;

export interface InvokeContractParams {
  /** Stellar account address of the transaction source */
  callerAddress: string;
  /** Deployed contract ID */
  contractId: string;
  /** Contract method name */
  method: string;
  /** Encoded ScVal arguments */
  args: xdr.ScVal[];
  /** Optional progress callback for step-by-step UI updates */
  onProgress?: PipelineProgressCallback;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRpc(): SorobanServer {
  return new SorobanServer(RPC_URL);
}

function devLog(label: string, payload: unknown): void {
  if (!IS_DEV) return;
  console.debug(`[soroban-pipeline][${label}]`, payload);
}

function extractTransactionFee(tx: Transaction): string {
  const fee = (tx as unknown as { fee?: string | number }).fee;
  if (typeof fee === "number") return String(fee);
  if (typeof fee === "string") return fee;
  return String(BASE_FEE);
}

function extractSimulationLog(
  sim: Api.SimulateTransactionResponse,
  unsignedTx: Transaction,
  preparedTx: Transaction,
): SimulationLog {
  // SimulateTransactionSuccessResponse carries transactionData (SorobanDataBuilder)
  // and minResourceFee. The cost field is not in the parsed type but may appear
  // on the raw response — we access it defensively.
  const asAny = (sim as unknown) as Record<string, unknown>;
  const cost = asAny["cost"] as { cpuInsns?: string; memBytes?: string } | undefined;
  const minFee =
    "minResourceFee" in sim
      ? (sim as Api.SimulateTransactionSuccessResponse).minResourceFee
      : "0";
  const transactionData =
    "transactionData" in sim
      ? (sim as Api.SimulateTransactionSuccessResponse).transactionData
      : null;

  return {
    raw: IS_DEV ? sim : undefined,
    baseFee: extractTransactionFee(unsignedTx),
    resourceFee: minFee,
    estimatedTotalFee: extractTransactionFee(preparedTx),
    cpuInsns: cost?.cpuInsns ?? "0",
    memBytes: cost?.memBytes ?? "0",
    // SorobanDataBuilder exposes readBytes/writeBytes as numbers
    readBytes: (transactionData as { readBytes?: number } | null)?.readBytes ?? 0,
    writeBytes: (transactionData as { writeBytes?: number } | null)?.writeBytes ?? 0,
  };
}

function isSequenceMismatch(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  return (
    msg.includes("tx_bad_seq") ||
    msg.includes("sequence") ||
    msg.includes("bad_seq")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core Pipeline ────────────────────────────────────────────────────────────

/**
 * Executes the full Build → Simulate → Sign → Submit → Confirm pipeline
 * for a single Soroban contract invocation.
 *
 * Retries up to MAX_SEQ_RETRIES times on sequence-number mismatch errors
 * by re-fetching the account and rebuilding the transaction from scratch.
 */
export async function invokeContract(
  params: InvokeContractParams,
): Promise<PipelineResult> {
  const { callerAddress, contractId, method, args, onProgress } = params;

  function emit(step: PipelineStep, extra: Partial<PipelineProgressEvent> = {}) {
    onProgress?.({ step, message: stepMessage(step), ...extra });
  }

  let seqAttempt = 0;

  while (seqAttempt <= MAX_SEQ_RETRIES) {
    try {
      return await runPipeline({
        callerAddress,
        contractId,
        method,
        args,
        emit,
      });
    } catch (err) {
      if (isSequenceMismatch(err) && seqAttempt < MAX_SEQ_RETRIES) {
        seqAttempt++;
        emit("building", {
          message: `Sequence mismatch — refreshing account and retrying (attempt ${seqAttempt}/${MAX_SEQ_RETRIES})…`,
        });
        // Brief pause before retry so the network can settle
        await sleep(1_000);
        continue;
      }
      emit("error", { message: errorMessage(err) });
      throw err;
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("Pipeline exhausted all retry attempts.");
}

interface RunPipelineParams {
  callerAddress: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  emit: (step: PipelineStep, extra?: Partial<PipelineProgressEvent>) => void;
}

async function runPipeline(params: RunPipelineParams): Promise<PipelineResult> {
  const { callerAddress, contractId, method, args, emit } = params;
  const rpc = getRpc();

  // ── Step 1: Build ──────────────────────────────────────────────────────────
  emit("building");

  // Always fetch the latest account to get the current sequence number.
  // This is also the fix for sequence-number-mismatch retries.
  const account = await rpc.getAccount(callerAddress);
  const contract = new Contract(contractId);

  const unsignedTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const unsignedXdr = IS_DEV ? unsignedTx.toXDR() : undefined;
  devLog("build", { method, unsignedXdr });
  emit("building", { unsignedXdr, message: "Transaction built." });

  // ── Step 2: Simulate ───────────────────────────────────────────────────────
  emit("simulating");

  const simResult = await rpc.simulateTransaction(unsignedTx);

  if ("error" in simResult && simResult.error) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // prepareTransaction assembles auth entries, footprint, and resource limits
  // from the simulation result into a ready-to-sign transaction.
  const preparedTx = await rpc.prepareTransaction(unsignedTx);
  const simulationLog = extractSimulationLog(simResult, unsignedTx, preparedTx);
  devLog("simulate", simulationLog);

  emit("simulating", {
    simulationLog,
    message: "Simulation complete. Resources and fees assembled.",
  });

  // ── Step 3: Sign ───────────────────────────────────────────────────────────
  emit("signing");

  const preparedXdr = preparedTx.toXDR();
  devLog("prepared-xdr", preparedXdr);
  const signedXdr = await signTransaction(preparedXdr);
  devLog("signed-xdr", IS_DEV ? signedXdr : "[redacted]");

  emit("signing", {
    signedXdr: IS_DEV ? signedXdr : undefined,
    message: "Transaction signed.",
  });

  // ── Step 4: Submit ─────────────────────────────────────────────────────────
  emit("submitting");

  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await rpc.sendTransaction(signedTx);

  if (sendResult.status === "ERROR") {
    const detail = JSON.stringify(sendResult.errorResult ?? {});
    throw new Error(`Submission rejected by RPC: ${detail}`);
  }

  const txHash = sendResult.hash;
  emit("submitting", { txHash, message: `Submitted. Hash: ${txHash}` });

  // ── Step 5: Confirm (Poll) ─────────────────────────────────────────────────
  emit("confirming", { txHash });

  const confirmedHash = await pollForConfirmation(rpc, txHash);

  emit("success", {
    txHash: confirmedHash,
    unsignedXdr,
    signedXdr: IS_DEV ? signedXdr : undefined,
    simulationLog,
    message: "Transaction confirmed on-chain.",
  });

  return {
    txHash: confirmedHash,
    unsignedXdr,
    signedXdr: IS_DEV ? signedXdr : undefined,
    simulationLog,
  };
}

// ─── Polling ──────────────────────────────────────────────────────────────────

async function pollForConfirmation(
  rpc: SorobanServer,
  txHash: string,
): Promise<string> {
  for (let attempt = 0; attempt < POLL_MAX_RETRIES; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let result: Api.GetTransactionResponse;
    try {
      result = await rpc.getTransaction(txHash);
    } catch {
      // Transient RPC error — keep polling
      continue;
    }

    if (result.status === Api.GetTransactionStatus.SUCCESS) {
      return txHash;
    }

    if (result.status === Api.GetTransactionStatus.FAILED) {
      // resultXdr is an xdr.TransactionResult on the parsed response
      const detail = "resultXdr" in result ? String(result.resultXdr) : "no detail available";
      throw new Error(`Transaction failed on-chain (hash: ${txHash}): ${detail}`);
    }

    // status === NOT_FOUND → still pending, continue polling
  }

  const timeoutSecs = (POLL_MAX_RETRIES * POLL_INTERVAL_MS) / 1_000;
  throw new Error(
    `Confirmation timed out after ${timeoutSecs}s (hash: ${txHash})`,
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function stepMessage(step: PipelineStep): string {
  switch (step) {
    case "idle":
      return "Ready.";
    case "building":
      return "Building transaction…";
    case "simulating":
      return "Simulating on Soroban RPC…";
    case "signing":
      return "Waiting for wallet signature…";
    case "submitting":
      return "Submitting to Testnet…";
    case "confirming":
      return "Waiting for on-chain confirmation…";
    case "success":
      return "Transaction confirmed.";
    case "error":
      return "Transaction failed.";
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred.";
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { APP_STELLAR_NETWORK, NETWORK_PASSPHRASE };
export type { Api };
