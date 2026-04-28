/**
 * index.ts
 *
 * Main export file for Soroban transaction building functionality.
 * Provides convenient access to transaction builder and XDR encoding utilities.
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
