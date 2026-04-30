/**
 * Soroban Integration Module
 *
 * Comprehensive toolkit for Soroban smart contract interactions:
 *  - Resource estimation and fee calculation
 *  - Transaction pipeline with progress tracking
 *  - UI components for transaction monitoring
 *  - React hooks for reactive state management
 *
 * @module soroban
 */

// ─── Resource Estimation ───────────────────────────────────────────────────────

export {
  SorobanResourceEstimator,
  DEFAULT_RESOURCE_LIMITS,
  RESOURCE_SAFETY_MARGIN,
  Asset,
  Memo,
} from "./soroban-resource-estimator";

export type {
  ResourceEstimate,
  FeeBreakdown,
  ResourceLimitsCheck,
  ResourceWarning,
  SimulationResult,
  RecommendedSettings,
  EstimateContractCallParams,
  EstimatePaymentParams,
} from "./soroban-resource-estimator";

// ─── Transaction Pipeline ─────────────────────────────────────────────────────

export {
  runSorobanPipeline,
  APP_STELLAR_NETWORK,
  NETWORK_PASSPHRASE,
} from "./soroban-pipeline";

export type {
  PipelineStep,
  SimulationLog,
  PipelineResult,
  PipelineProgressEvent,
  PipelineProgressCallback,
  InvokeContractParams,
} from "./soroban-pipeline";

// ─── Re-export SDK types for convenience ──────────────────────────────────────

export type { Api } from "@stellar/stellar-sdk/rpc";
export { xdr, Contract, Address, ScInt } from "@stellar/stellar-sdk";
