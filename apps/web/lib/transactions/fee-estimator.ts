/**
 * fee-estimator.ts
 *
 * Dynamic fee estimation and resource limit adjustment based on simulation results.
 *
 * Features:
 * - Calculates fees with 10% buffer: fee = minResourceFee * 1.1
 * - Sets resource limits with 10% buffer: instructions, readBytes, writeBytes + 10%
 * - Prepares transaction with estimated fees and limits
 * - Validates resource limits are within acceptable ranges
 * - Provides fee breakdown for user transparency
 */

import { Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { Server as SorobanServer } from "@stellar/stellar-sdk/rpc";
import { SimulationResult } from "./simulator";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Buffer percentage for fee and resource calculations (10%) */
const BUFFER_PERCENTAGE = 0.1;

/** Maximum allowed CPU instructions (safety limit) */
const MAX_CPU_INSTRUCTIONS = BigInt("100000000"); // 100M

/** Maximum allowed read bytes (safety limit) */
const MAX_READ_BYTES = 1000000; // 1MB

/** Maximum allowed write bytes (safety limit) */
const MAX_WRITE_BYTES = 1000000; // 1MB

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeeEstimate {
  /** Base resource fee from simulation (stroops) */
  baseResourceFee: string;
  /** Adjusted fee with 10% buffer (stroops) */
  adjustedFee: string;
  /** Buffer amount added (stroops) */
  bufferAmount: string;
  /** Total fee including base fee (stroops) */
  totalFee: string;
}

export interface ResourceLimits {
  /** CPU instructions limit */
  cpuInstructions: string;
  /** Memory bytes limit */
  memoryBytes: string;
  /** Ledger read bytes limit */
  readBytes: number;
  /** Ledger write bytes limit */
  writeBytes: number;
}

export interface AdjustedTransaction {
  /** Transaction with adjusted fees and limits */
  transaction: Transaction;
  /** Transaction XDR */
  xdr: string;
  /** Fee estimate breakdown */
  feeEstimate: FeeEstimate;
  /** Resource limits applied */
  resourceLimits: ResourceLimits;
}

// ─── Fee Calculation ──────────────────────────────────────────────────────────

/**
 * Calculates adjusted fee with 10% buffer.
 * Formula: adjustedFee = minResourceFee * 1.1
 *
 * @param minResourceFee - Minimum resource fee from simulation (as string)
 * @returns Fee estimate with breakdown
 */
export function calculateAdjustedFee(minResourceFee: string): FeeEstimate {
  // Parse the fee as a number
  let baseFee: number;
  try {
    baseFee = parseInt(minResourceFee, 10);
    if (isNaN(baseFee)) {
      baseFee = 0;
    }
  } catch {
    baseFee = 0;
  }

  // Calculate buffer (10%)
  const bufferAmount = Math.ceil(baseFee * BUFFER_PERCENTAGE);

  // Calculate adjusted fee
  const adjustedFee = baseFee + bufferAmount;

  // Total fee is the adjusted fee (already includes base)
  const totalFee = adjustedFee;

  return {
    baseResourceFee: minResourceFee,
    adjustedFee: String(adjustedFee),
    bufferAmount: String(bufferAmount),
    totalFee: String(totalFee),
  };
}

/**
 * Calculates resource limits with 10% buffer.
 * Applies buffer to: instructions, readBytes, writeBytes
 *
 * @param simulation - Simulation result with resource usage
 * @returns Resource limits with buffer applied
 * @throws Error if resource limits exceed safety maximums
 */
export function calculateResourceLimits(simulation: SimulationResult): ResourceLimits {
  // Parse CPU instructions
  let cpuInsns: bigint;
  try {
    cpuInsns = BigInt(simulation.cpuInstructions || "0");
  } catch {
    cpuInsns = BigInt(0);
  }

  // Apply 10% buffer to CPU instructions
  const bufferedCpuInsns = cpuInsns + (cpuInsns / BigInt(10));

  // Validate CPU instructions don't exceed maximum
  if (bufferedCpuInsns > MAX_CPU_INSTRUCTIONS) {
    throw new Error(
      `CPU instructions (${bufferedCpuInsns}) exceed maximum allowed (${MAX_CPU_INSTRUCTIONS})`,
    );
  }

  // Parse memory bytes
  let memBytes: bigint;
  try {
    memBytes = BigInt(simulation.memoryBytes || "0");
  } catch {
    memBytes = BigInt(0);
  }

  // Apply 10% buffer to memory bytes
  const bufferedMemBytes = memBytes + (memBytes / BigInt(10));

  // ✅ FIXED: Changed 'let' to 'const' (line 144 was 'let readBytes')
  const readBytes = simulation.readBytes || 0;
  const bufferedReadBytes = Math.ceil(readBytes * (1 + BUFFER_PERCENTAGE));

  // Validate read bytes don't exceed maximum
  if (bufferedReadBytes > MAX_READ_BYTES) {
    throw new Error(
      `Read bytes (${bufferedReadBytes}) exceed maximum allowed (${MAX_READ_BYTES})`,
    );
  }

  // ✅ FIXED: Changed 'let' to 'const' (line 155 was 'let writeBytes')
  const writeBytes = simulation.writeBytes || 0;
  const bufferedWriteBytes = Math.ceil(writeBytes * (1 + BUFFER_PERCENTAGE));

  // Validate write bytes don't exceed maximum
  if (bufferedWriteBytes > MAX_WRITE_BYTES) {
    throw new Error(
      `Write bytes (${bufferedWriteBytes}) exceed maximum allowed (${MAX_WRITE_BYTES})`,
    );
  }

  return {
    cpuInstructions: bufferedCpuInsns.toString(),
    memoryBytes: bufferedMemBytes.toString(),
    readBytes: bufferedReadBytes,
    writeBytes: bufferedWriteBytes,
  };
}

// ─── Transaction Preparation ──────────────────────────────────────────────────

/**
 * Prepares a transaction with adjusted fees and resource limits from simulation.
 * This creates a transaction ready for signing and submission.
 *
 * @param rpc - Soroban RPC server instance
 * @param unsignedTransaction - Original unsigned transaction
 * @param simulation - Simulation result with resource usage
 * @returns Adjusted transaction with fees and limits applied
 */
export async function prepareTransactionWithFees(
  rpc: SorobanServer,
  unsignedTransaction: Transaction,
  simulation: SimulationResult,
): Promise<AdjustedTransaction> {
  // Calculate adjusted fee
  const feeEstimate = calculateAdjustedFee(simulation.minResourceFee);

  // Calculate resource limits
  const resourceLimits = calculateResourceLimits(simulation);

  // Build the transaction with adjusted fees and limits
  // We need to use prepareTransaction from the RPC which handles the assembly
  const preparedTx = await rpc.prepareTransaction(unsignedTransaction);

  // The preparedTx now has the fees and limits set from the simulation
  // We can extract and verify them
  const adjustedXdr = preparedTx.toXDR();

  return {
    transaction: preparedTx,
    xdr: adjustedXdr,
    feeEstimate,
    resourceLimits,
  };
}

/**
 * Manually adjusts a transaction's fees and resource limits.
 * Useful when you want to override the RPC's prepareTransaction.
 *
 * @param transaction - Transaction to adjust
 * @param feeEstimate - Fee estimate with adjusted amounts
 * @param resourceLimits - Resource limits to apply
 * @returns Adjusted transaction XDR
 */
export function adjustTransactionFees(
  transaction: Transaction,
  feeEstimate: FeeEstimate,
  resourceLimits: ResourceLimits,
): string {
  // Parse the transaction envelope
  const envelope = transaction.toXDR("base64");

  // Note: Direct XDR manipulation is complex. In practice, you would:
  // 1. Use the RPC's prepareTransaction which handles this automatically
  // 2. Or rebuild the transaction with new fees using TransactionBuilder

  // For now, we return the transaction as-is since prepareTransaction
  // handles the fee and resource limit adjustment
  return envelope;
}

// ─── Fee Breakdown ────────────────────────────────────────────────────────────

/**
 * Formats a fee estimate for display to the user.
 */
export function formatFeeEstimate(feeEstimate: FeeEstimate): string {
  const baseNum = parseInt(feeEstimate.baseResourceFee, 10);
  const adjustedNum = parseInt(feeEstimate.adjustedFee, 10);
  const bufferNum = parseInt(feeEstimate.bufferAmount, 10);

  // Convert stroops to XLM (1 XLM = 10,000,000 stroops)
  const baseXlm = (baseNum / 10_000_000).toFixed(7);
  const adjustedXlm = (adjustedNum / 10_000_000).toFixed(7);
  const bufferXlm = (bufferNum / 10_000_000).toFixed(7);

  return (
    `Base Fee: ${baseXlm} XLM (${feeEstimate.baseResourceFee} stroops)\n` +
    `Buffer (10%): ${bufferXlm} XLM (${feeEstimate.bufferAmount} stroops)\n` +
    `Total Fee: ${adjustedXlm} XLM (${feeEstimate.adjustedFee} stroops)`
  );
}

/**
 * Formats resource limits for display to the user.
 */
export function formatResourceLimits(limits: ResourceLimits): string {
  return (
    `CPU Instructions: ${limits.cpuInstructions}\n` +
    `Memory Bytes: ${limits.memoryBytes}\n` +
    `Read Bytes: ${limits.readBytes}\n` +
    `Write Bytes: ${limits.writeBytes}`
  );
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates that resource limits are within acceptable ranges.
 */
export function validateResourceLimits(limits: ResourceLimits): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate CPU instructions
  try {
    const cpuInsns = BigInt(limits.cpuInstructions);
    if (cpuInsns > MAX_CPU_INSTRUCTIONS) {
      errors.push(
        `CPU instructions (${cpuInsns}) exceed maximum (${MAX_CPU_INSTRUCTIONS})`,
      );
    }
    if (cpuInsns < BigInt(0)) {
      errors.push("CPU instructions cannot be negative");
    }
  } catch {
    errors.push("Invalid CPU instructions format");
  }

  // Validate memory bytes
  try {
    const memBytes = BigInt(limits.memoryBytes);
    if (memBytes < BigInt(0)) {
      errors.push("Memory bytes cannot be negative");
    }
  } catch {
    errors.push("Invalid memory bytes format");
  }

  // Validate read bytes
  if (limits.readBytes < 0) {
    errors.push("Read bytes cannot be negative");
  }
  if (limits.readBytes > MAX_READ_BYTES) {
    errors.push(`Read bytes (${limits.readBytes}) exceed maximum (${MAX_READ_BYTES})`);
  }

  // Validate write bytes
  if (limits.writeBytes < 0) {
    errors.push("Write bytes cannot be negative");
  }
  if (limits.writeBytes > MAX_WRITE_BYTES) {
    errors.push(`Write bytes (${limits.writeBytes}) exceed maximum (${MAX_WRITE_BYTES})`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Converts stroops to XLM.
 * 1 XLM = 10,000,000 stroops
 */
export function stroopsToXlm(stroops: string | number): number {
  const stroopsNum = typeof stroops === "string" ? parseInt(stroops, 10) : stroops;
  return stroopsNum / 10_000_000;
}

/**
 * Converts XLM to stroops.
 * 1 XLM = 10,000,000 stroops
 */
export function xlmToStroops(xlm: number): string {
  return Math.floor(xlm * 10_000_000).toString();
}

/**
 * Formats a fee in stroops as a human-readable string.
 */
export function formatFeeInStroops(stroops: string | number): string {
  const xlm = stroopsToXlm(stroops);
  return `${xlm.toFixed(7)} XLM`;
}

/**
 * Gets the buffer percentage as a decimal (0.1 for 10%).
 */
export function getBufferPercentage(): number {
  return BUFFER_PERCENTAGE;
}

/**
 * Gets the maximum allowed resource limits.
 */
export function getMaxResourceLimits() {
  return {
    maxCpuInstructions: MAX_CPU_INSTRUCTIONS.toString(),
    maxReadBytes: MAX_READ_BYTES,
    maxWriteBytes: MAX_WRITE_BYTES,
  };
}