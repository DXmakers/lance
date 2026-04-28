/**
 * index.ts
 *
 * Main export file for Soroban transaction building functionality.
 * Provides convenient access to transaction builder, XDR encoding, simulation, and fee estimation.
 */

export {
  SorobanTransactionBuilder,
  createTransactionBuilder,
  buildContractInvocationTransaction,
  // Argument helpers
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
} from "./builder";

export type {
  TransactionBuilderConfig,
  ContractInvocationParams,
  BuildTransactionResult,
  SorobanArgument,
  SorobanAddress,
  SorobanI128,
  SorobanU256,
  SorobanBytes,
  SorobanVec,
  SorobanMap,
} from "./builder";

export {
  encodeArgument,
  encodeArguments as encodeArgumentsXdr,
  decodeScVal as decodeScValXdr,
} from "./xdr-encoder";

export type { SorobanArgument as SorobanArgumentType } from "./xdr-encoder";

export {
  simulateTransaction,
  clearSimulationCache,
  getSimulationCacheSize,
  isSimulationCached,
  getSimulationErrorMessage,
} from "./simulator";

export type { SimulationResult, SimulationError } from "./simulator";

export {
  calculateAdjustedFee,
  calculateResourceLimits,
  prepareTransactionWithFees,
  adjustTransactionFees,
  formatFeeEstimate,
  formatResourceLimits,
  validateResourceLimits,
  stroopsToXlm,
  xlmToStroops,
  formatFeeInStroops,
  getBufferPercentage,
  getMaxResourceLimits,
} from "./fee-estimator";

export type {
  FeeEstimate,
  ResourceLimits,
  AdjustedTransaction,
} from "./fee-estimator";
