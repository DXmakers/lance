/**
 * xdr-encoder.ts
 *
 * Comprehensive XDR construction logic for Soroban contract arguments.
 * Handles conversion of JavaScript types to Soroban ScVal types including:
 * - Address types (wallet addresses to Soroban Address)
 * - Numeric types (i128, u256, u64, i64)
 * - Bytes and strings
 * - Custom composite types
 */

import { xdr, Address as StellarAddress, StrKey } from "@stellar/stellar-sdk";

// ─── Type Definitions ─────────────────────────────────────────────────────────

export type SorobanArgument =
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

export interface SorobanAddress {
  type: "address";
  value: string; // Stellar account address (G...) or contract ID
}

export interface SorobanI128 {
  type: "i128";
  value: bigint;
}

export interface SorobanU256 {
  type: "u256";
  value: bigint;
}

export interface SorobanBytes {
  type: "bytes";
  value: Uint8Array;
}

export interface SorobanVec {
  type: "vec";
  elements: SorobanArgument[];
}

export interface SorobanMap {
  type: "map";
  entries: Array<[SorobanArgument, SorobanArgument]>;
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

function isSorobanAddress(arg: unknown): arg is SorobanAddress {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "address"
  );
}

function isSorobanI128(arg: unknown): arg is SorobanI128 {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "i128"
  );
}

function isSorobanU256(arg: unknown): arg is SorobanU256 {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "u256"
  );
}

function isSorobanBytes(arg: unknown): arg is SorobanBytes {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "bytes"
  );
}

function isSorobanVec(arg: unknown): arg is SorobanVec {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "vec"
  );
}

function isSorobanMap(arg: unknown): arg is SorobanMap {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    (arg as Record<string, unknown>).type === "map"
  );
}

// ─── Address Conversion ────────────────────────────────────────────────────────

/**
 * Converts a Stellar account address (G...) or contract ID to a Soroban Address type.
 * Validates the address format and throws if invalid.
 */
export function addressToSoroban(address: string): SorobanAddress {
  // Validate that it's a valid Stellar address or contract ID
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContractId(address)) {
    throw new Error(
      `Invalid Stellar address or contract ID: ${address}. ` +
        `Expected G... (account) or C... (contract).`,
    );
  }

  return {
    type: "address",
    value: address,
  };
}

/**
 * Converts a Soroban Address back to a Stellar address string.
 */
export function sorobanAddressToString(addr: SorobanAddress): string {
  return addr.value;
}

// ─── Numeric Type Constructors ────────────────────────────────────────────────

/**
 * Creates a Soroban i128 (signed 128-bit integer) from a bigint.
 * Validates that the value fits within i128 range: -(2^127) to 2^127 - 1
 */
export function createI128(value: bigint): SorobanI128 {
  const min = -(BigInt(2) ** BigInt(127));
  const max = BigInt(2) ** BigInt(127) - BigInt(1);

  if (value < min || value > max) {
    throw new Error(
      `i128 value out of range: ${value}. ` +
        `Expected value between ${min} and ${max}.`,
    );
  }

  return {
    type: "i128",
    value,
  };
}

/**
 * Creates a Soroban u256 (unsigned 256-bit integer) from a bigint.
 * Validates that the value fits within u256 range: 0 to 2^256 - 1
 */
export function createU256(value: bigint): SorobanU256 {
  const min = BigInt(0);
  const max = BigInt(2) ** BigInt(256) - BigInt(1);

  if (value < min || value > max) {
    throw new Error(
      `u256 value out of range: ${value}. ` +
        `Expected value between ${min} and ${max}.`,
    );
  }

  return {
    type: "u256",
    value,
  };
}

/**
 * Creates a Soroban bytes type from a Uint8Array or Buffer.
 */
export function createBytes(data: Uint8Array | Buffer): SorobanBytes {
  return {
    type: "bytes",
    value: new Uint8Array(data),
  };
}

/**
 * Creates a Soroban bytes type from a hex string (with or without 0x prefix).
 */
export function createBytesFromHex(hexString: string): SorobanBytes {
  const hex = hexString.startsWith("0x") ? hexString.slice(2) : hexString;

  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`Invalid hex string: ${hexString}`);
  }

  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string must have even length: ${hexString}`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  return {
    type: "bytes",
    value: bytes,
  };
}

/**
 * Creates a Soroban bytes type from a UTF-8 string.
 */
export function createBytesFromString(str: string): SorobanBytes {
  const encoder = new TextEncoder();
  return {
    type: "bytes",
    value: encoder.encode(str),
  };
}

/**
 * Creates a Soroban vector (array) of arguments.
 */
export function createVec(elements: SorobanArgument[]): SorobanVec {
  return {
    type: "vec",
    elements,
  };
}

/**
 * Creates a Soroban map (key-value pairs).
 */
export function createMap(
  entries: Array<[SorobanArgument, SorobanArgument]>,
): SorobanMap {
  return {
    type: "map",
    entries,
  };
}

// ─── XDR Encoding ─────────────────────────────────────────────────────────────

/**
 * Encodes a Soroban argument to XDR ScVal format.
 * Handles all supported types: primitives, addresses, custom types, and composites.
 */
export function encodeArgument(arg: SorobanArgument): xdr.ScVal {
  // Handle null
  if (arg === null) {
    return xdr.ScVal.scValTypeVoid();
  }

  // Handle boolean
  if (typeof arg === "boolean") {
    return xdr.ScVal.scValTypeBool(arg);
  }

  // Handle string (encoded as UTF-8 bytes)
  if (typeof arg === "string") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(arg);
    return xdr.ScVal.scValTypeBytes(Buffer.from(bytes));
  }

  // Handle number (encoded as i64)
  if (typeof arg === "number") {
    if (!Number.isInteger(arg)) {
      throw new Error(`Cannot encode non-integer number: ${arg}`);
    }
    if (arg < Number.MIN_SAFE_INTEGER || arg > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Number out of safe integer range: ${arg}`);
    }
    return xdr.ScVal.scValTypeI64(xdr.Int64.fromString(String(arg)));
  }

  // Handle bigint (encoded as i128 by default)
  if (typeof arg === "bigint") {
    return encodeI128(arg);
  }

  // Handle Uint8Array (encoded as bytes)
  if (arg instanceof Uint8Array) {
    return xdr.ScVal.scValTypeBytes(Buffer.from(arg));
  }

  // Handle custom Soroban types
  if (isSorobanAddress(arg)) {
    return encodeAddress(arg);
  }

  if (isSorobanI128(arg)) {
    return encodeI128(arg.value);
  }

  if (isSorobanU256(arg)) {
    return encodeU256(arg.value);
  }

  if (isSorobanBytes(arg)) {
    return xdr.ScVal.scValTypeBytes(Buffer.from(arg.value));
  }

  if (isSorobanVec(arg)) {
    return encodeVec(arg.elements);
  }

  if (isSorobanMap(arg)) {
    return encodeMapType(arg.entries);
  }

  throw new Error(`Unsupported argument type: ${typeof arg}`);
}

/**
 * Encodes a Soroban Address to XDR format.
 * Converts the address string to the appropriate XDR Address type.
 */
function encodeAddress(addr: SorobanAddress): xdr.ScVal {
  const addressStr = addr.value;

  // Determine if it's an account address or contract ID
  if (StrKey.isValidEd25519PublicKey(addressStr)) {
    // Account address (G...)
    const publicKey = StrKey.decodeEd25519PublicKey(addressStr);
    const accountId = xdr.AccountId.keyTypeEd25519(
      xdr.Uint256.fromBuffer(Buffer.from(publicKey)),
    );
    const address = xdr.Address.addressTypeAccount(accountId);
    return xdr.ScVal.scValTypeAddress(address);
  } else if (StrKey.isValidContractId(addressStr)) {
    // Contract ID (C...)
    const contractIdBuffer = StrKey.decodeContractId(addressStr);
    const contractId = xdr.Hash.fromBuffer(Buffer.from(contractIdBuffer));
    const address = xdr.Address.addressTypeContract(contractId);
    return xdr.ScVal.scValTypeAddress(address);
  } else {
    throw new Error(`Invalid address format: ${addressStr}`);
  }
}

/**
 * Encodes a signed 128-bit integer to XDR format.
 */
function encodeI128(value: bigint): xdr.ScVal {
  // i128 is represented as two i64 values (hi and lo)
  const hi = value >> BigInt(64);
  const lo = value & BigInt("0xFFFFFFFFFFFFFFFF");

  // Handle sign extension for negative numbers
  const hiSigned = hi > BigInt("0x7FFFFFFFFFFFFFFF")
    ? hi - BigInt("0x10000000000000000")
    : hi;

  const parts = xdr.Int128Parts.int128PartsHiLo(
    xdr.Int64.fromString(hiSigned.toString()),
    xdr.Uint64.fromString(lo.toString()),
  );

  return xdr.ScVal.scValTypeI128(parts);
}

/**
 * Encodes an unsigned 256-bit integer to XDR format.
 */
function encodeU256(value: bigint): xdr.ScVal {
  // u256 is represented as four u64 values
  const mask64 = BigInt("0xFFFFFFFFFFFFFFFF");

  const lo = value & mask64;
  const mid_lo = (value >> BigInt(64)) & mask64;
  const mid_hi = (value >> BigInt(128)) & mask64;
  const hi = (value >> BigInt(192)) & mask64;

  const parts = xdr.UInt256Parts.uint256PartsHiLoLoHi(
    xdr.Uint64.fromString(hi.toString()),
    xdr.Uint64.fromString(mid_hi.toString()),
    xdr.Uint64.fromString(mid_lo.toString()),
    xdr.Uint64.fromString(lo.toString()),
  );

  return xdr.ScVal.scValTypeU256(parts);
}

/**
 * Encodes a vector (array) of arguments to XDR format.
 */
function encodeVec(elements: SorobanArgument[]): xdr.ScVal {
  const encodedElements = elements.map((el) => encodeArgument(el));
  return xdr.ScVal.scValTypeVec(encodedElements);
}

/**
 * Encodes a map (key-value pairs) to XDR format.
 */
function encodeMapType(entries: Array<[SorobanArgument, SorobanArgument]>): xdr.ScVal {
  const encodedEntries = entries.map(([key, value]) => {
    return xdr.ScMapEntry.scMapEntry(encodeArgument(key), encodeArgument(value));
  });

  return xdr.ScVal.scValTypeMap(encodedEntries);
}

/**
 * Encodes multiple arguments to XDR format.
 * Useful for contract function invocations with multiple parameters.
 */
export function encodeArguments(args: SorobanArgument[]): xdr.ScVal[] {
  return args.map((arg) => encodeArgument(arg));
}

// ─── Decoding (for reference/testing) ──────────────────────────────────────────

/**
 * Decodes an XDR ScVal back to a JavaScript value.
 * Useful for testing and debugging.
 */
export function decodeScVal(scVal: xdr.ScVal): unknown {
  switch (scVal.switch()) {
    case xdr.ScValType.scValTypeVoid():
      return null;

    case xdr.ScValType.scValTypeBool():
      return scVal.b();

    case xdr.ScValType.scValTypeI64():
      return BigInt(scVal.i64().toString());

    case xdr.ScValType.scValTypeU64():
      return BigInt(scVal.u64().toString());

    case xdr.ScValType.scValTypeI128(): {
      const parts = scVal.i128();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << BigInt(64)) | lo;
    }

    case xdr.ScValType.scValTypeU128(): {
      const parts = scVal.u128();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << BigInt(64)) | lo;
    }

    case xdr.ScValType.scValTypeU256(): {
      const parts = scVal.u256();
      const hi = BigInt(parts.hi().toString());
      const midHi = BigInt(parts.midHi().toString());
      const midLo = BigInt(parts.midLo().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << BigInt(192)) | (midHi << BigInt(128)) | (midLo << BigInt(64)) | lo;
    }

    case xdr.ScValType.scValTypeI256(): {
      const parts = scVal.i256();
      const hi = BigInt(parts.hi().toString());
      const midHi = BigInt(parts.midHi().toString());
      const midLo = BigInt(parts.midLo().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << BigInt(192)) | (midHi << BigInt(128)) | (midLo << BigInt(64)) | lo;
    }

    case xdr.ScValType.scValTypeBytes():
      return scVal.bytes();

    case xdr.ScValType.scValTypeString():
      return scVal.str().toString();

    case xdr.ScValType.scValTypeVec():
      return scVal.vec()?.map((el) => decodeScVal(el)) ?? [];

    case xdr.ScValType.scValTypeMap():
      return (
        scVal.map()?.map((entry) => [
          decodeScVal(entry.key()),
          decodeScVal(entry.val()),
        ]) ?? []
      );

    case xdr.ScValType.scValTypeAddress(): {
      const addr = scVal.address();
      if (addr.switch() === xdr.AddressType.addressTypeAccount()) {
        const accountId = addr.accountId();
        const publicKey = accountId.ed25519().toString("hex");
        return StrKey.encodeEd25519PublicKey(Buffer.from(publicKey, "hex"));
      } else if (addr.switch() === xdr.AddressType.addressTypeContract()) {
        const contractId = addr.contractId();
        return StrKey.encodeContractId(contractId);
      }
      return null;
    }

    default:
      return null;
  }
}
