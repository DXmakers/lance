/**
 * builder.ts
 *
 * Core transaction builder for Soroban contract calls.
 * Handles:
 * - Transaction header construction (source account, sequence, fee)
 * - Contract function invocation with named or positional arguments
 * - Proper timebounds (minTime = 0, maxTime = current + 300 seconds)
 * - XDR encoding of contract arguments
 */

import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Server as SorobanServer } from "@stellar/stellar-sdk/rpc";
import {
  encodeArguments,
  SorobanArgument,
  addressToSoroban,
  createI128,
  createU256,
  createBytes,
  createBytesFromHex,
  createBytesFromString,
  createVec,
  createMap,
} from "./xdr-encoder";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface TransactionBuilderConfig {
  /** Soroban RPC URL for fetching account data */
  rpcUrl: string;
  /** Stellar network passphrase (TESTNET_NETWORK_PASSPHRASE or PUBLIC_NETWORK_PASSPHRASE) */
  networkPassphrase: Networks;
  /** Base fee in stroops (default: BASE_FEE = 100) */
  baseFee?: number;
  /** Transaction timeout in seconds (default: 30) */
  timeoutSeconds?: number;
}

export interface ContractInvocationParams {
  /** Caller's Stellar account address (G...) */
  callerAddress: string;
  /** Deployed contract ID (C...) */
  contractId: string;
  /** Contract method name */
  method: string;
  /** Contract method arguments (can be named or positional) */
  args: SorobanArgument[] | Record<string, SorobanArgument>;
}

export interface BuildTransactionResult {
  /** Unsigned transaction XDR */
  unsignedXdr: string;
  /** Transaction object for further processing */
  transaction: Transaction;
  /** Encoded contract arguments (for reference) */
  encodedArgs: xdr.ScVal[];
}

// ─── Transaction Builder Class ────────────────────────────────────────────────

export class SorobanTransactionBuilder {
  private rpc: SorobanServer;
  private config: Required<TransactionBuilderConfig>;

  constructor(config: TransactionBuilderConfig) {
    this.rpc = new SorobanServer(config.rpcUrl);
    this.config = {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      baseFee: config.baseFee ?? BASE_FEE,
      timeoutSeconds: config.timeoutSeconds ?? 30,
    };
  }

  /**
   * Builds an unsigned Soroban contract invocation transaction.
   *
   * Steps:
   * 1. Fetch the caller's account from the RPC to get current sequence number
   * 2. Encode contract arguments to XDR format
   * 3. Create a TransactionBuilder with proper headers
   * 4. Add the contract invocation operation
   * 5. Set timebounds (minTime = 0, maxTime = current + 300 seconds)
   * 6. Build and return the unsigned transaction
   */
  async buildContractInvocation(
    params: ContractInvocationParams,
  ): Promise<BuildTransactionResult> {
    const { callerAddress, contractId, method, args } = params;

    // ── Step 1: Fetch Account ──────────────────────────────────────────────
    const account = await this.fetchAccount(callerAddress);

    // ── Step 2: Encode Arguments ───────────────────────────────────────────
    const encodedArgs = this.encodeContractArguments(args);

    // ── Step 3: Create TransactionBuilder ──────────────────────────────────
    const builder = new TransactionBuilder(account, {
      fee: this.config.baseFee,
      networkPassphrase: this.config.networkPassphrase,
    });

    // ── Step 4: Add Contract Invocation Operation ──────────────────────────
    const contract = new Contract(contractId);
    builder.addOperation(contract.call(method, ...encodedArgs));

    // ── Step 5: Set Timebounds ─────────────────────────────────────────────
    // minTime = 0 (no minimum)
    // maxTime = current time + 300 seconds
    const currentTime = Math.floor(Date.now() / 1000);
    const maxTime = currentTime + 300;
    builder.setTimebounds(0, maxTime);

    // ── Step 6: Build Transaction ──────────────────────────────────────────
    const transaction = builder.build();
    const unsignedXdr = transaction.toXDR();

    return {
      unsignedXdr,
      transaction,
      encodedArgs,
    };
  }

  /**
   * Fetches the caller's account from the Soroban RPC.
   * This is necessary to get the current sequence number for the transaction.
   */
  private async fetchAccount(address: string): Promise<Account> {
    try {
      const account = await this.rpc.getAccount(address);
      return account;
    } catch (error) {
      throw new Error(
        `Failed to fetch account ${address} from RPC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Encodes contract arguments to XDR format.
   * Supports both positional (array) and named (object) argument formats.
   */
  private encodeContractArguments(
    args: SorobanArgument[] | Record<string, SorobanArgument>,
  ): xdr.ScVal[] {
    // If args is an array, encode directly
    if (Array.isArray(args)) {
      return encodeArguments(args);
    }

    // If args is an object, extract values in order
    // Note: Object key order is preserved in modern JavaScript
    const values = Object.values(args);
    return encodeArguments(values);
  }
}

// ─── Convenience Functions ────────────────────────────────────────────────────

/**
 * Creates a new SorobanTransactionBuilder with default configuration.
 */
export function createTransactionBuilder(
  rpcUrl: string,
  networkPassphrase: Networks,
  config?: Partial<TransactionBuilderConfig>,
): SorobanTransactionBuilder {
  return new SorobanTransactionBuilder({
    rpcUrl,
    networkPassphrase,
    ...config,
  });
}

/**
 * Builds a contract invocation transaction in a single call.
 * Useful for simple, one-off transactions.
 */
export async function buildContractInvocationTransaction(
  rpcUrl: string,
  networkPassphrase: Networks,
  params: ContractInvocationParams,
  config?: Partial<TransactionBuilderConfig>,
): Promise<BuildTransactionResult> {
  const builder = createTransactionBuilder(rpcUrl, networkPassphrase, config);
  return builder.buildContractInvocation(params);
}

// ─── Argument Helpers (Re-exports for convenience) ────────────────────────────

export {
  addressToSoroban,
  createI128,
  createU256,
  createBytes,
  createBytesFromHex,
  createBytesFromString,
  createVec,
  createMap,
  encodeArguments,
  decodeScVal,
} from "./xdr-encoder";

export type {
  SorobanArgument,
  SorobanAddress,
  SorobanI128,
  SorobanU256,
  SorobanBytes,
  SorobanVec,
  SorobanMap,
} from "./xdr-encoder";
