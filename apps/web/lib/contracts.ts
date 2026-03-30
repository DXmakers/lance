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
import { Server as SorobanServer } from "@stellar/stellar-sdk/rpc";
import { getWalletsKit, signTransaction } from "./stellar";

// ─── Config ───────────────────────────────────────────────────────────────────

const ESCROW_CONTRACT_ID = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? "";
const USDC_CONTRACT_ID = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID ?? "";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_RETRIES = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the public key of the currently connected wallet. */
async function getCallerAddress(): Promise<string> {
  const { address } = await getWalletsKit().getAddress();
  return address;
}

/**
 * Core Soroban invocation pipeline:
 *   1. Load source account from RPC.
 *   2. Build TransactionBuilder with the contract call operation.
 *   3. prepareTransaction: simulates + assembles auth/footprint in one call.
 *   4. Serialise to XDR and pass to signTransaction() (Freighter/wallet).
 *   5. Submit signed XDR to the Soroban RPC.
 *   6. Poll until SUCCESS or FAILED; return the confirmed transaction hash.
 */
async function invokeEscrow(
  callerAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "FAKE_TX_HASH";
  if (!ESCROW_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured.");
  }

  const rpc = new SorobanServer(RPC_URL);
  const account = await rpc.getAccount(callerAddress);
  const contract = new Contract(ESCROW_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate the transaction and assemble auth/footprint entries.
  const prepared = await rpc.prepareTransaction(tx);
  const xdrStr = prepared.toXDR();

  // Hand off to the wallet for signing (stellar.ts / Freighter).
  const signedXdr = await signTransaction(xdrStr);
  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);

  // Broadcast to the Soroban RPC.
  const sendResult = await rpc.sendTransaction(signedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${JSON.stringify(sendResult.errorResult)}`,
    );
  }

  const txHash = sendResult.hash;

  // Poll for on-chain confirmation.
  for (let i = 0; i < POLL_MAX_RETRIES; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await rpc.getTransaction(txHash);
    if (result.status === "SUCCESS") return txHash;
    if (result.status === "FAILED") {
      throw new Error(`Transaction failed on-chain (hash: ${txHash})`);
    }
    // status === "NOT_FOUND" means still pending — keep polling
  }

  throw new Error(
    `Confirmation timed out after ${POLL_MAX_RETRIES * (POLL_INTERVAL_MS / 1_000)}s (hash: ${txHash})`,
  );
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Calls escrow.deposit — locks USDC into the escrow for a given job.
 *
 * Validates parameters client-side before building the XDR so that
 * invalid inputs (e.g. zero amount or missing addresses) throw immediately
 * without submitting a transaction.
 *
 * @returns Confirmed transaction hash on Testnet.
 */
export async function depositEscrow(params: {
  jobId: bigint;
  clientAddress: string;
  freelancerAddress: string;
  amountUsdc: bigint;
  milestones: number;
}): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "FAKE_TX_HASH";
  const { jobId, clientAddress, freelancerAddress, amountUsdc, milestones } = params;

  // ── Parameter validation (throws before any network call) ─────────────────
  if (!USDC_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_USDC_CONTRACT_ID is not configured.");
  }
  if (amountUsdc <= 0n) {
    throw new Error("Invalid amount: amountUsdc must be greater than zero.");
  }
  if (milestones < 1) {
    throw new Error("Invalid milestones: must be at least 1.");
  }
  if (!clientAddress) {
    throw new Error("clientAddress is required.");
  }
  if (!freelancerAddress) {
    throw new Error("freelancerAddress is required.");
  }

  // Contract: deposit(job_id: u64, client: Address, freelancer: Address,
  //                   token_addr: Address, amount: i128, milestones: u32)
  return invokeEscrow(clientAddress, "deposit", [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(clientAddress).toScVal(),
    Address.fromString(freelancerAddress).toScVal(),
    Address.fromString(USDC_CONTRACT_ID).toScVal(),
    nativeToScVal(amountUsdc, { type: "i128" }),
    nativeToScVal(milestones, { type: "u32" }),
  ]);
}

/**
 * Calls escrow.release_milestone — transitions the next milestone on-chain.
 * The caller (client) is derived from the connected wallet.
 *
 * @returns Confirmed transaction hash.
 */
export async function releaseMilestone(jobId: bigint): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "FAKE_TX_HASH";
  if (jobId < 0n) {
    throw new Error("Invalid jobId: must be a non-negative integer.");
  }
  const callerAddress = await getCallerAddress();

  // Contract: release_milestone(job_id: u64, caller: Address)
  return invokeEscrow(callerAddress, "release_milestone", [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(callerAddress).toScVal(),
  ]);
}

/**
 * Calls escrow.release_funds for an explicit milestone index.
 *
 * @returns Confirmed transaction hash.
 */
export async function releaseFunds(
  jobId: bigint,
  milestoneIndex: number,
): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "FAKE_TX_HASH";
  if (jobId < 0n) {
    throw new Error("Invalid jobId: must be a non-negative integer.");
  }
  if (milestoneIndex < 0) {
    throw new Error("Invalid milestone index.");
  }

  const callerAddress = await getCallerAddress();

  return invokeEscrow(callerAddress, "release_funds", [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(callerAddress).toScVal(),
    nativeToScVal(milestoneIndex, { type: "u32" }),
  ]);
}

/**
 * Calls escrow.open_dispute — raises a dispute on the escrow job.
 * The caller (client or freelancer) is derived from the connected wallet.
 *
 * @returns Confirmed transaction hash.
 */
export async function openDispute(jobId: bigint): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "FAKE_TX_HASH";
  if (jobId < 0n) {
    throw new Error("Invalid jobId: must be a non-negative integer.");
  }
  const callerAddress = await getCallerAddress();

  // Contract: open_dispute(job_id: u64, caller: Address)
  return invokeEscrow(callerAddress, "open_dispute", [
    nativeToScVal(jobId, { type: "u64" }),
    Address.fromString(callerAddress).toScVal(),
  ]);
}
