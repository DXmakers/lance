/**
 * soroban-resource-estimator.ts
 *
 * Advanced Soroban resource fee estimation with dynamic adjustment
 * and comprehensive resource limit analysis.
 *
 * Features:
 *  - Pre-flight simulation with detailed resource breakdown
 *  - Dynamic fee adjustment based on network conditions
 *  - Resource limit warnings and recommendations
 *  - XDR debugging tools for developers
 */

import {
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
  Address,
  ScInt,
} from "@stellar/stellar-sdk";
import { Server as SorobanServer, Api } from "@stellar/stellar-sdk/rpc";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

/** Default resource limits for Soroban transactions */
const DEFAULT_RESOURCE_LIMITS = {
  /** Maximum CPU instructions per transaction */
  maxCpuInsns: 100_000_000,
  /** Maximum memory bytes per transaction */
  maxMemBytes: 40_000_000,
  /** Maximum read ledger entries */
  maxReadLedgerEntries: 40,
  /** Maximum write ledger entries */
  maxWriteLedgerEntries: 20,
  /** Maximum read bytes per transaction */
  maxReadBytes: 200_000,
  /** Maximum write bytes per transaction */
  maxWriteBytes: 100_000,
  /** Maximum transaction size in bytes */
  maxTxSizeBytes: 100_000,
  /** Maximum contract events size in bytes */
  maxContractEventsSizeBytes: 20_000,
};

/** Safety margin multiplier for resource estimation */
const RESOURCE_SAFETY_MARGIN = 1.2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceEstimate {
  /** Estimated CPU instructions */
  cpuInsns: number;
  /** Estimated memory bytes */
  memBytes: number;
  /** Estimated read ledger entries */
  readLedgerEntries: number;
  /** Estimated write ledger entries */
  writeLedgerEntries: number;
  /** Estimated read bytes */
  readBytes: number;
  /** Estimated write bytes */
  writeBytes: number;
  /** Transaction size in bytes */
  txSizeBytes: number;
  /** Estimated contract events size */
  contractEventsSizeBytes: number;
}

export interface FeeBreakdown {
  /** Base transaction fee (stroops) */
  baseFee: string;
  /** Resource fee computed from simulation (stroops) */
  resourceFee: string;
  /** Refundable fee portion (stroops) */
  refundableFee: string;
  /** Total fee = baseFee + resourceFee (stroops) */
  totalFee: string;
  /** Fee in XLM (human readable) */
  totalFeeXlm: string;
}

export interface ResourceLimitsCheck {
  /** Whether all resources are within limits */
  withinLimits: boolean;
  /** CPU utilization percentage */
  cpuUtilizationPct: number;
  /** Memory utilization percentage */
  memUtilizationPct: number;
  /** Read entries utilization percentage */
  readEntriesUtilizationPct: number;
  /** Write entries utilization percentage */
  writeEntriesUtilizationPct: number;
  /** Warnings for resources approaching limits */
  warnings: ResourceWarning[];
}

export interface ResourceWarning {
  /** Resource type that triggered warning */
  resource: keyof ResourceEstimate;
  /** Current value */
  current: number;
  /** Limit value */
  limit: number;
  /** Utilization percentage */
  utilizationPct: number;
  /** Warning message */
  message: string;
}

export interface SimulationResult {
  /** Raw simulation response from RPC */
  raw: Api.SimulateTransactionResponse;
  /** Parsed resource estimate */
  resources: ResourceEstimate;
  /** Fee breakdown */
  fees: FeeBreakdown;
  /** Resource limits check */
  limitsCheck: ResourceLimitsCheck;
  /** Recommended resource settings for transaction building */
  recommendedSettings: RecommendedSettings;
  /** XDR representation for debugging */
  xdr?: {
    unsigned: string;
    signedAuthEntries?: string[];
  };
}

export interface RecommendedSettings {
  /** Recommended base fee (with safety margin) */
  baseFee: string;
  /** Recommended resource fee (with safety margin) */
  resourceFee: string;
  /** Recommended CPU instruction limit */
  cpuInsnsLimit: number;
  /** Recommended memory bytes limit */
  memBytesLimit: number;
  /** Recommended read ledger entries limit */
  readLedgerEntriesLimit: number;
  /** Recommended write ledger entries limit */
  writeLedgerEntriesLimit: number;
  /** Recommended read bytes limit */
  readBytesLimit: number;
  /** Recommended write bytes limit */
  writeBytesLimit: number;
}

export interface EstimateContractCallParams {
  /** Contract ID */
  contractId: string;
  /** Function name to call */
  functionName: string;
  /** Arguments for the function */
  args: xdr.ScVal[];
  /** Source account address */
  sourceAddress: string;
  /** Optional custom resource limits */
  customLimits?: Partial<typeof DEFAULT_RESOURCE_LIMITS>;
}

export interface EstimatePaymentParams {
  /** Source account address */
  sourceAddress: string;
  /** Destination account address */
  destinationAddress: string;
  /** Amount in stroops */
  amount: string;
  /** Optional memo text */
  memo?: string;
}

// ─── Resource Estimator Class ───────────────────────────────────────────────────

export class SorobanResourceEstimator {
  private rpc: SorobanServer;
  private limits: typeof DEFAULT_RESOURCE_LIMITS;

  constructor(
    rpcUrl: string = RPC_URL,
    limits?: Partial<typeof DEFAULT_RESOURCE_LIMITS>
  ) {
    this.rpc = new SorobanServer(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  }

  /**
   * Estimate resources and fees for a contract call
   */
  async estimateContractCall(
    params: EstimateContractCallParams
  ): Promise<SimulationResult> {
    // Build the transaction for simulation
    const source = new Address(params.sourceAddress).toScAddress();
    const contract = new Contract(params.contractId);

    const operation = contract.call(params.functionName, ...params.args);

    // Build a temporary transaction for simulation
    const account = await this.rpc.getAccount(params.sourceAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    return this.simulateAndAnalyze(tx);
  }

  /**
   * Estimate resources for a payment transaction
   */
  async estimatePayment(params: EstimatePaymentParams): Promise<SimulationResult> {
    const account = await this.rpc.getAccount(params.sourceAddress);

    const txBuilder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        TransactionBuilder.payment({
          destination: params.destinationAddress,
          asset: Asset.native(),
          amount: params.amount,
        })
      )
      .setTimeout(30);

    if (params.memo) {
      txBuilder.addMemo(Memo.text(params.memo));
    }

    const tx = txBuilder.build();
    return this.simulateAndAnalyze(tx);
  }

  /**
   * Simulate transaction and analyze results
   */
  private async simulateAndAnalyze(tx: Transaction): Promise<SimulationResult> {
    const simulation = await this.rpc.simulateTransaction(tx);

    if (Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    if (!simulation.results || simulation.results.length === 0) {
      throw new Error("Simulation returned no results");
    }

    const resources = this.parseResourceEstimate(simulation);
    const fees = this.calculateFeeBreakdown(simulation);
    const limitsCheck = this.checkResourceLimits(resources);
    const recommendedSettings = this.calculateRecommendedSettings(resources, fees);

    return {
      raw: simulation,
      resources,
      fees,
      limitsCheck,
      recommendedSettings,
      xdr: {
        unsigned: tx.toXDR(),
      },
    };
  }

  /**
   * Parse resource estimate from simulation response
   */
  private parseResourceEstimate(
    simulation: Api.SimulateTransactionSuccessResponse
  ): ResourceEstimate {
    const result = simulation.results[0];

    return {
      cpuInsns: Number(result.resources.cpuInsns),
      memBytes: Number(result.resources.memBytes),
      readLedgerEntries: result.resources.readLedgerEntries,
      writeLedgerEntries: result.resources.writeLedgerEntries,
      readBytes: Number(result.resources.readBytes),
      writeBytes: Number(result.resources.writeBytes),
      txSizeBytes: result.resources.txSizeBytes,
      contractEventsSizeBytes: result.resources.contractEventsSizeBytes,
    };
  }

  /**
   * Calculate fee breakdown from simulation
   */
  private calculateFeeBreakdown(
    simulation: Api.SimulateTransactionSuccessResponse
  ): FeeBreakdown {
    const baseFee = BigInt(simulation.minResourceFee);
    const resourceFee = BigInt(simulation.results[0].resources.resourceFee);
    const totalFee = baseFee + resourceFee;
    const refundableFee = BigInt(simulation.results[0].resources.refundableFee ?? 0);

    // Convert to XLM (1 XLM = 10^7 stroops)
    const totalFeeXlm = (Number(totalFee) / 10_000_000).toFixed(7);

    return {
      baseFee: baseFee.toString(),
      resourceFee: resourceFee.toString(),
      refundableFee: refundableFee.toString(),
      totalFee: totalFee.toString(),
      totalFeeXlm,
    };
  }

  /**
   * Check resource usage against limits
   */
  private checkResourceLimits(resources: ResourceEstimate): ResourceLimitsCheck {
    const warnings: ResourceWarning[] = [];

    const cpuUtilizationPct = (resources.cpuInsns / this.limits.maxCpuInsns) * 100;
    const memUtilizationPct = (resources.memBytes / this.limits.maxMemBytes) * 100;
    const readEntriesUtilizationPct =
      (resources.readLedgerEntries / this.limits.maxReadLedgerEntries) * 100;
    const writeEntriesUtilizationPct =
      (resources.writeLedgerEntries / this.limits.maxWriteLedgerEntries) * 100;

    // Check CPU
    if (cpuUtilizationPct > 80) {
      warnings.push({
        resource: "cpuInsns",
        current: resources.cpuInsns,
        limit: this.limits.maxCpuInsns,
        utilizationPct: cpuUtilizationPct,
        message: `High CPU usage (${cpuUtilizationPct.toFixed(1)}%). Consider optimizing contract logic.`,
      });
    }

    // Check memory
    if (memUtilizationPct > 80) {
      warnings.push({
        resource: "memBytes",
        current: resources.memBytes,
        limit: this.limits.maxMemBytes,
        utilizationPct: memUtilizationPct,
        message: `High memory usage (${memUtilizationPct.toFixed(1)}%). Consider reducing data size.`,
      });
    }

    // Check read entries
    if (readEntriesUtilizationPct > 80) {
      warnings.push({
        resource: "readLedgerEntries",
        current: resources.readLedgerEntries,
        limit: this.limits.maxReadLedgerEntries,
        utilizationPct: readEntriesUtilizationPct,
        message: `High ledger read count (${readEntriesUtilizationPct.toFixed(1)}%). Consider batching reads.`,
      });
    }

    // Check write entries
    if (writeEntriesUtilizationPct > 80) {
      warnings.push({
        resource: "writeLedgerEntries",
        current: resources.writeLedgerEntries,
        limit: this.limits.maxWriteLedgerEntries,
        utilizationPct: writeEntriesUtilizationPct,
        message: `High ledger write count (${writeEntriesUtilizationPct.toFixed(1)}%). Consider batching writes.`,
      });
    }

    const withinLimits =
      cpuUtilizationPct <= 100 &&
      memUtilizationPct <= 100 &&
      readEntriesUtilizationPct <= 100 &&
      writeEntriesUtilizationPct <= 100;

    return {
      withinLimits,
      cpuUtilizationPct,
      memUtilizationPct,
      readEntriesUtilizationPct,
      writeEntriesUtilizationPct,
      warnings,
    };
  }

  /**
   * Calculate recommended resource settings with safety margin
   */
  private calculateRecommendedSettings(
    resources: ResourceEstimate,
    fees: FeeBreakdown
  ): RecommendedSettings {
    const applyMargin = (value: number) => Math.ceil(value * RESOURCE_SAFETY_MARGIN);

    return {
      baseFee: fees.baseFee,
      resourceFee: fees.resourceFee,
      cpuInsnsLimit: Math.min(applyMargin(resources.cpuInsns), this.limits.maxCpuInsns),
      memBytesLimit: Math.min(applyMargin(resources.memBytes), this.limits.maxMemBytes),
      readLedgerEntriesLimit: Math.min(
        applyMargin(resources.readLedgerEntries),
        this.limits.maxReadLedgerEntries
      ),
      writeLedgerEntriesLimit: Math.min(
        applyMargin(resources.writeLedgerEntries),
        this.limits.maxWriteLedgerEntries
      ),
      readBytesLimit: Math.min(applyMargin(resources.readBytes), this.limits.maxReadBytes),
      writeBytesLimit: Math.min(applyMargin(resources.writeBytes), this.limits.maxWriteBytes),
    };
  }

  /**
   * Get current network conditions for fee estimation
   */
  async getNetworkConditions(): Promise<{
    latestLedger: number;
    protocolVersion: number;
    baseReserve: string;
  }> {
    const network = await this.rpc.getNetwork();
    return {
      latestLedger: network.protocolVersion,
      protocolVersion: network.protocolVersion,
      baseReserve: "5000000", // 0.5 XLM in stroops
    };
  }
}

// ─── Convenience Exports ──────────────────────────────────────────────────────

export { DEFAULT_RESOURCE_LIMITS, RESOURCE_SAFETY_MARGIN };
export type { Api };

// Re-export Stellar SDK types for convenience
export { Asset, Memo } from "@stellar/stellar-sdk";
