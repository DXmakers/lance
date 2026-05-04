# Soroban Transaction Builder

Comprehensive transaction builder with XDR construction logic for Soroban contract calls.

## Overview

This module provides a complete solution for building, encoding, and preparing Soroban contract invocation transactions. It handles:

- **Transaction Headers**: Source account, sequence number, fee, timebounds
- **Contract Arguments**: Encoding of all Soroban types (Address, i128, u256, bytes, etc.)
- **XDR Encoding**: Proper conversion to Stellar XDR format
- **Address Conversion**: Wallet address to Soroban Address type conversion

## Files

### `xdr-encoder.ts` (14.5 KB)
Comprehensive XDR construction logic for Soroban contract arguments.

**Key Features:**
- Type-safe argument encoding
- Support for all Soroban types (primitives, addresses, custom types)
- Address conversion (G... account to Soroban Address)
- Numeric type constructors (i128, u256)
- Bytes and string handling
- Vector and map support
- Decoding utilities for testing

**Supported Types:**
- `null` → Void
- `boolean` → Bool
- `string` → Bytes (UTF-8 encoded)
- `number` → i64
- `bigint` → i128 (default)
- `Uint8Array` → Bytes
- `SorobanAddress` → Address (account or contract)
- `SorobanI128` → i128 (signed 128-bit)
- `SorobanU256` → u256 (unsigned 256-bit)
- `SorobanBytes` → Bytes
- `SorobanVec` → Vector
- `SorobanMap` → Map

### `builder.ts` (7.6 KB)
Core transaction builder for Soroban contract calls.

**Key Features:**
- `SorobanTransactionBuilder` class for building transactions
- Automatic account fetching from RPC
- Proper transaction headers (source, sequence, fee)
- Contract function invocation with named or positional arguments
- Timebounds: minTime = 0, maxTime = current + 300 seconds
- Convenience functions for one-off transactions

**Main Class:**
```typescript
class SorobanTransactionBuilder {
  constructor(config: TransactionBuilderConfig)
  async buildContractInvocation(params: ContractInvocationParams): Promise<BuildTransactionResult>
}
```

### `index.ts` (0.9 KB)
Main export file for convenient access to all functionality.

## Usage Examples

### Basic Contract Invocation

```typescript
import {
  createTransactionBuilder,
  addressToSoroban,
  createI128,
} from "@/lib/transactions";
import { Networks } from "@stellar/stellar-sdk";

const builder = createTransactionBuilder(
  "https://soroban-testnet.stellar.org",
  Networks.TESTNET_NETWORK_PASSPHRASE,
);

const result = await builder.buildContractInvocation({
  callerAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  method: "transfer",
  args: [
    addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
    addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
    createI128(BigInt(1000)),
  ],
});

console.log("Unsigned XDR:", result.unsignedXdr);
```

### Named Arguments

```typescript
const result = await builder.buildContractInvocation({
  callerAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  method: "approve",
  args: {
    spender: addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
    amount: createI128(BigInt(5000)),
  },
});
```

### Custom Types

```typescript
import {
  createU256,
  createBytes,
  createBytesFromHex,
  createVec,
  createMap,
} from "@/lib/transactions";

// u256 (unsigned 256-bit)
const largeAmount = createU256(BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"));

// Bytes from hex
const data = createBytesFromHex("0x48656c6c6f"); // "Hello"

// Bytes from string
const text = createBytesFromString("Hello, Soroban!");

// Vector
const addresses = createVec([
  addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
  addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
]);

// Map
const metadata = createMap([
  [createBytesFromString("key1"), createBytesFromString("value1")],
  [createBytesFromString("key2"), createI128(BigInt(42))],
]);
```

### One-Off Transaction

```typescript
import { buildContractInvocationTransaction } from "@/lib/transactions";

const result = await buildContractInvocationTransaction(
  "https://soroban-testnet.stellar.org",
  Networks.TESTNET_NETWORK_PASSPHRASE,
  {
    callerAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    method: "mint",
    args: [
      addressToSoroban("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2EURIDVXL6B"),
      createI128(BigInt(1000000)),
    ],
  },
);
```

### Integration with Soroban Pipeline

```typescript
import { invokeContract } from "@/lib/soroban-pipeline";
import { buildContractInvocationTransaction } from "@/lib/transactions";

// Build the transaction
const buildResult = await buildContractInvocationTransaction(
  rpcUrl,
  networkPassphrase,
  {
    callerAddress: userAddress,
    contractId: contractId,
    method: "transfer",
    args: [fromAddr, toAddr, amount],
  },
);

// Use with the pipeline
const pipelineResult = await invokeContract({
  callerAddress: userAddress,
  contractId: contractId,
  method: "transfer",
  args: buildResult.encodedArgs,
  onProgress: (event) => console.log(event.message),
});
```

## API Reference

### XDR Encoder

#### Type Constructors

```typescript
// Address conversion
addressToSoroban(address: string): SorobanAddress

// Numeric types
createI128(value: bigint): SorobanI128
createU256(value: bigint): SorobanU256

// Bytes
createBytes(data: Uint8Array | Buffer): SorobanBytes
createBytesFromHex(hexString: string): SorobanBytes
createBytesFromString(str: string): SorobanBytes

// Collections
createVec(elements: SorobanArgument[]): SorobanVec
createMap(entries: Array<[SorobanArgument, SorobanArgument]>): SorobanMap
```

#### Encoding

```typescript
// Encode single argument
encodeArgument(arg: SorobanArgument): xdr.ScVal

// Encode multiple arguments
encodeArguments(args: SorobanArgument[]): xdr.ScVal[]

// Decode for testing
decodeScVal(scVal: xdr.ScVal): unknown
```

### Transaction Builder

#### Configuration

```typescript
interface TransactionBuilderConfig {
  rpcUrl: string;
  networkPassphrase: Networks;
  baseFee?: number; // default: BASE_FEE (100)
  timeoutSeconds?: number; // default: 30
}
```

#### Parameters

```typescript
interface ContractInvocationParams {
  callerAddress: string; // G... account
  contractId: string; // C... contract
  method: string; // method name
  args: SorobanArgument[] | Record<string, SorobanArgument>;
}
```

#### Result

```typescript
interface BuildTransactionResult {
  unsignedXdr: string; // Unsigned transaction XDR
  transaction: Transaction; // Transaction object
  encodedArgs: xdr.ScVal[]; // Encoded arguments
}
```

## Type Definitions

### Soroban Argument Types

```typescript
type SorobanArgument =
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | SorobanAddress
  | SorobanI128
  | SorobanU256
  | SorobanBytes
  | SorobanVec
  | SorobanMap
  | null;

interface SorobanAddress {
  type: "address";
  value: string; // G... or C...
}

interface SorobanI128 {
  type: "i128";
  value: bigint;
}

interface SorobanU256 {
  type: "u256";
  value: bigint;
}

interface SorobanBytes {
  type: "bytes";
  value: Uint8Array;
}

interface SorobanVec {
  type: "vec";
  elements: SorobanArgument[];
}

interface SorobanMap {
  type: "map";
  entries: Array<[SorobanArgument, SorobanArgument]>;
}
```

## Features

### ✅ Comprehensive Type Support
- All Soroban primitive types
- Custom types (Address, i128, u256)
- Collections (Vec, Map)
- Proper XDR encoding

### ✅ Address Conversion
- Stellar account addresses (G...) to Soroban Address
- Contract IDs (C...) to Soroban Address
- Validation and error handling

### ✅ Transaction Headers
- Automatic account fetching
- Proper sequence number handling
- Configurable fees
- Timebounds: minTime = 0, maxTime = current + 300 seconds

### ✅ Argument Handling
- Named arguments (object format)
- Positional arguments (array format)
- Type-safe encoding
- Validation with helpful error messages

### ✅ Integration
- Works with Soroban pipeline
- Compatible with wallet signing
- Proper XDR format for RPC submission

## Error Handling

The builder includes comprehensive error handling:

```typescript
try {
  const result = await builder.buildContractInvocation({
    callerAddress: "invalid-address",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    method: "transfer",
    args: [],
  });
} catch (error) {
  console.error("Build failed:", error.message);
  // "Failed to fetch account invalid-address from RPC: ..."
}
```

## Validation

The builder validates:
- Address formats (G... or C...)
- Numeric ranges (i128, u256)
- Hex string formats
- Argument types

## Performance

- Minimal dependencies (uses Stellar SDK only)
- Efficient XDR encoding
- No unnecessary allocations
- Suitable for high-frequency transactions

## Testing

```typescript
import { encodeArgument, decodeScVal } from "@/lib/transactions";

// Encode and decode round-trip
const original = createI128(BigInt(12345));
const encoded = encodeArgument(original);
const decoded = decodeScVal(encoded);
console.log(decoded); // 12345n
```

## Related Files

- `soroban-pipeline.ts` - Full transaction pipeline (Build → Simulate → Sign → Submit → Confirm)
- `stellar.ts` - Stellar SDK utilities and wallet integration
- `contracts.ts` - Contract registry and metadata

## Stellar SDK Version

Requires `@stellar/stellar-sdk` v13.0.0 or later.

## License

See LICENSE file in repository root.
