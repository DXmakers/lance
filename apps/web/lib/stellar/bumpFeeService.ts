/**
 * bumpFeeService.ts
 *
 * Implements the "Bump Fee" functionality for the Lance escrow platform.
 * Handles full Soroban transaction lifecycle:
 *   1. Build  – XDR construction with contract args
 *   2. Simulate – fee/resource estimation via RPC
 *   3. Sign  – wallet-delegated signing (Freighter / stellar-wallets-kit)
 *   4. Submit – send to Testnet RPC
 *   5. Poll  – async status monitoring until confirmation or failure
 *
 * Security notes:
 *  - Private keys never touch this module; all signing is delegated to the
 *    connected wallet provider through @creit.tech/stellar-wallets-kit.
 *  - XDR is logged only in development builds.
 */

import {
  Contract,
  Networks,
  rpc as SorobanRpc,
  Transaction,
  TransactionBuilder,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkPassphrase =
  | typeof Networks.TESTNET
  | typeof Networks.PUBLIC;

export interface BumpFeeParams {
  /** Soroban contract ID (C… address) */
  contractId: string;
  /** Name of the contract function to invoke */
  functionName: string;
  /** Arguments to pass to the contract function, as native JS values */
  args: unknown[];
  /** Stellar public key of the signing account */
  sourcePublicKey: string;
  /** Extra fee padding on top of simulated minimum (in stroops). Default 10 000 */
  feePadding?: number;
  /** Maximum number of polling attempts before giving up. Default 30 */
  maxPollAttempts?: number;
  /** Milliseconds between poll attempts. Default 2 000 */
  pollIntervalMs?: number;
}

export type TxStatus =
  | "building"
  | "simulating"
  | "awaiting_signature"
  | "submitting"
  | "polling"
  | "success"
  | "error";

export interface BumpFeeResult {
  status: "success" | "error";
  txHash?: string;
  ledger?: number;
  resultXdr?: string;
  errorMessage?: string;
}

export type StatusCallback = (status: TxStatus, detail?: string) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_FEE_PADDING = 10_000; // stroops
const DEFAULT_MAX_POLL = 30;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const BASE_FEE = "100"; // minimum base fee in stroops

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === "development";

function devLog(...args: unknown[]): void {
  if (isDev) {
    console.debug("[BumpFeeService]", ...args);
  }
}

/**
 * Convert a native JS value to an xdr.ScVal.
 * Supports: string, number, bigint, boolean, Uint8Array (bytes),
 * Address (Stellar address strings starting with G or C).
 */
function toScVal(value: unknown): xdr.ScVal {
  if (typeof value === "string") {
    // Stellar public key or contract address → Address ScVal
    if (/^[GC][A-Z2-7]{55}$/.test(value)) {
      return new Address(value).toScVal();
    }
    return nativeToScVal(value, { type: "string" });
  }
  if (typeof value === "bigint") {
    return nativeToScVal(value, { type: "i128" });
  }
  if (value instanceof Uint8Array) {
    return xdr.ScVal.scvBytes(Buffer.from(value));
  }
  return nativeToScVal(value);
}

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------

export class BumpFeeService {
  private readonly server: SorobanRpc.Server;
  private readonly networkPassphrase: NetworkPassphrase;

  constructor(
    rpcUrl: string = TESTNET_RPC_URL,
    networkPassphrase: NetworkPassphrase = Networks.TESTNET,
  ) {
    this.server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
    this.networkPassphrase = networkPassphrase;
  }

  // -------------------------------------------------------------------------
  // Public entry-point
  // -------------------------------------------------------------------------

  /**
   * Full lifecycle: build → simulate → sign → submit → poll.
   *
   * @param params     BumpFeeParams describing the invocation
   * @param signTx     Wallet-provided signing function. Receives a base64 XDR
   *                   transaction envelope and must return the signed XDR.
   * @param onStatus   Optional callback for UI status updates.
   */
  async execute(
    params: BumpFeeParams,
    signTx: (xdrEnvelope: string) => Promise<string>,
    onStatus?: StatusCallback,
  ): Promise<BumpFeeResult> {
    const {
      contractId,
      functionName,
      args,
      sourcePublicKey,
      feePadding = DEFAULT_FEE_PADDING,
      maxPollAttempts = DEFAULT_MAX_POLL,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    } = params;

    try {
      // ── 1. BUILD ──────────────────────────────────────────────────────────
      onStatus?.("building");

      const account = await this._loadAccount(sourcePublicKey);
      const scArgs = args.map(toScVal);
      const contract = new Contract(contractId);

      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(functionName, ...scArgs))
        .setTimeout(300);

      const builtTx = txBuilder.build();
      devLog("Built TX XDR:", builtTx.toXDR());

      // ── 2. SIMULATE ───────────────────────────────────────────────────────
      onStatus?.("simulating");

      const simResult = await this._simulate(builtTx);
      devLog("Simulation result:", JSON.stringify(simResult, null, 2));

      if (SorobanRpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }

      if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
        throw new Error("Simulation returned an unexpected response");
      }

      // ── 3. ASSEMBLE + BUMP FEE ────────────────────────────────────────────
      const preparedTx = SorobanRpc.assembleTransaction(
        builtTx,
        simResult,
      ).build();

      const bumpedTx = this._applyFeeBump(preparedTx, feePadding, simResult);
      devLog("Prepared TX XDR (post-simulation):", bumpedTx.toXDR());

      // ── 4. SIGN ───────────────────────────────────────────────────────────
      onStatus?.("awaiting_signature");

      const signedXdr = await signTx(bumpedTx.toXDR());
      const signedTx = new Transaction(signedXdr, this.networkPassphrase);

      // ── 5. SUBMIT ─────────────────────────────────────────────────────────
      onStatus?.("submitting");

      const sendResponse = await this.server.sendTransaction(signedTx);
      devLog("sendTransaction response:", sendResponse);

      if (sendResponse.status === "ERROR") {
        const msg =
          sendResponse.errorResult?.result().toString() ?? "Unknown error";
        throw new Error(`Transaction rejected by RPC: ${msg}`);
      }

      const txHash = sendResponse.hash;

      // ── 6. POLL ───────────────────────────────────────────────────────────
      onStatus?.("polling", txHash);

      const confirmation = await this._pollUntilConfirmed(
        txHash,
        maxPollAttempts,
        pollIntervalMs,
      );

      onStatus?.("success", txHash);

      return {
        status: "success",
        txHash,
        ledger: confirmation.ledger,
        resultXdr: confirmation.resultXdr,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onStatus?.("error", message);
      return { status: "error", errorMessage: message };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load the source account, retrying once on sequence-number mismatch.
   */
  private async _loadAccount(publicKey: string, retryCount = 0): Promise<any> {
    try {
      const account = await this.server.getAccount(publicKey);
      return account;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (retryCount === 0 && message.includes("sequence")) {
        devLog("Sequence mismatch detected – refreshing account state…");
        return this._loadAccount(publicKey, 1);
      }
      throw new Error(`Failed to load account ${publicKey}: ${message}`);
    }
  }

  /**
   * Submit a transaction to the simulation endpoint.
   */
  private async _simulate(
    tx: Transaction,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return this.server.simulateTransaction(tx);
  }

  /**
   * Apply a fee bump on top of the simulation's minimum resource fee.
   * Dynamically adjusts CPU / memory limits from simulation data.
   */
  private _applyFeeBump(
    tx: Transaction,
    padding: number,
    simResult: SorobanRpc.Api.SimulateTransactionSuccessResponse,
  ): Transaction {
    const minResourceFee = parseInt(simResult.minResourceFee ?? "0", 10);
    const bumpedFee = (minResourceFee + padding).toString();

    devLog(
      `Fee bump: minResourceFee=${minResourceFee}, padding=${padding}, total=${bumpedFee}`,
    );

    // Re-build with the bumped fee by cloning via XDR
    const txEnvelope = xdr.TransactionEnvelope.fromXDR(tx.toXDR(), "base64");
    const innerTx = txEnvelope.v1().tx();
    innerTx.fee(parseInt(bumpedFee, 10));

    return new Transaction(txEnvelope.toXDR("base64"), this.networkPassphrase);
  }

  /**
   * Poll getTransaction until status is SUCCESS or FAILED,
   * or until maxAttempts is reached.
   */
  private async _pollUntilConfirmed(
    txHash: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<{ ledger: number; resultXdr: string }> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      await this._sleep(intervalMs);
      attempts++;

      let getResult: SorobanRpc.Api.GetTransactionResponse;
      try {
        getResult = await this.server.getTransaction(txHash);
      } catch (err) {
        devLog(`Poll attempt ${attempts} errored:`, err);
        continue; // transient RPC error – keep polling
      }

      devLog(`Poll attempt ${attempts}:`, getResult.status);

      if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          ledger: getResult.ledger,
          resultXdr: getResult.resultXdr?.toXDR("base64") ?? "",
        };
      }

      if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        const detail = getResult.resultXdr?.toXDR("base64") ?? "no result XDR";
        throw new Error(`Transaction failed on-chain. Result XDR: ${detail}`);
      }

      // Status is NOT_FOUND or PENDING – keep polling
    }

    throw new Error(
      `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`,
    );
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

let _instance: BumpFeeService | null = null;

/**
 * Returns (or creates) a singleton BumpFeeService pointed at Testnet.
 */
export function getBumpFeeService(): BumpFeeService {
  if (!_instance) {
    _instance = new BumpFeeService(TESTNET_RPC_URL, Networks.TESTNET);
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// React hook helper (thin wrapper – drop into hooks/useBumpFee.ts)
// ---------------------------------------------------------------------------

/**
 * Minimal hook interface example.  Import and adapt inside a React component.
 *
 * @example
 * const { execute, status, result } = useBumpFeeCallback(kit);
 */
export interface UseBumpFeeState {
  status: TxStatus | null;
  result: BumpFeeResult | null;
  execute: (params: BumpFeeParams) => Promise<BumpFeeResult>;
}

export function createBumpFeeCallback(
  /** Signing function backed by @creit.tech/stellar-wallets-kit */
  signXdr: (xdrEnvelope: string) => Promise<string>,
  onStatusChange?: StatusCallback,
): (params: BumpFeeParams) => Promise<BumpFeeResult> {
  const service = getBumpFeeService();
  return (params: BumpFeeParams) =>
    service.execute(params, signXdr, onStatusChange);
}
