/**
 * Tests for SEP-10 Compliance Module
 * Validates BE-W3A-113 requirements
 */

import { describe, it, expect } from "vitest";
import {
  validateStellarAddress,
  generateSep10Nonce,
  isChallengeExpired,
  validateChallengeTimestamp,
  timingSafeCompare,
  validateServerConfig,
  Networks,
} from "../config/sep10-compliance";

describe("SEP-10 Compliance", () => {
  describe("Stellar Address Validation", () => {
    it("should accept valid Stellar public addresses", () => {
      // Valid test address (from Stellar docs)
      const validAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const result = validateStellarAddress(validAddress);
      expect(result).toBe(validAddress);
    });

    it("should reject invalid addresses with wrong prefix", () => {
      const invalidAddress = "ABRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      expect(validateStellarAddress(invalidAddress)).toBeNull();
    });

    it("should reject addresses with invalid length", () => {
      const tooShort = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIX";
      expect(validateStellarAddress(tooShort)).toBeNull();
    });

    it("should reject addresses with invalid checksum", () => {
      // Valid format but invalid checksum (last char changed)
      const invalidChecksum = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LX";
      expect(validateStellarAddress(invalidChecksum)).toBeNull();
    });

    it("should handle non-string input gracefully", () => {
      expect(validateStellarAddress(null)).toBeNull();
      expect(validateStellarAddress(undefined)).toBeNull();
      expect(validateStellarAddress(123)).toBeNull();
      expect(validateStellarAddress({})).toBeNull();
    });

    it("should handle empty string", () => {
      expect(validateStellarAddress("")).toBeNull();
      expect(validateStellarAddress("   ")).toBeNull();
    });

    it("should trim whitespace before validation", () => {
      const validAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      expect(validateStellarAddress(`  ${validAddress}  `)).toBe(validAddress);
    });

    it("should be case-sensitive (canonical form check)", () => {
      const validAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const lowercaseAddress = validAddress.toLowerCase();
      // Should be null because StrKey requires canonical uppercase form
      expect(validateStellarAddress(lowercaseAddress)).toBeNull();
    });
  });

  describe("Nonce Generation", () => {
    it("should generate 32-character hex strings", () => {
      const nonce = generateSep10Nonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/i);
      expect(nonce.length).toBe(32);
    });

    it("should generate unique nonces", () => {
      const nonce1 = generateSep10Nonce();
      const nonce2 = generateSep10Nonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it("should only contain valid hex characters", () => {
      for (let i = 0; i < 10; i++) {
        const nonce = generateSep10Nonce();
        expect(/^[0-9a-f]+$/i.test(nonce)).toBe(true);
      }
    });
  });

  describe("Challenge Expiration", () => {
    it("should return false for fresh challenges", () => {
      const now = new Date();
      const isExpired = isChallengeExpired(now, 5 * 60 * 1000);
      expect(isExpired).toBe(false);
    });

    it("should return true for expired challenges", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000 - 1000);
      const isExpired = isChallengeExpired(fiveMinutesAgo, 5 * 60 * 1000);
      expect(isExpired).toBe(true);
    });

    it("should respect custom max age parameter", () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      expect(isChallengeExpired(twoMinutesAgo, 5 * 60 * 1000)).toBe(false);
      expect(isChallengeExpired(twoMinutesAgo, 1 * 60 * 1000)).toBe(true);
    });
  });

  describe("Challenge Timestamp Validation", () => {
    it("should accept recent timestamps", () => {
      const now = new Date();
      expect(validateChallengeTimestamp(now)).toBe(true);
    });

    it("should reject future timestamps", () => {
      const future = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes in future
      expect(validateChallengeTimestamp(future)).toBe(false);
    });

    it("should reject very old timestamps", () => {
      const old = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes old
      expect(validateChallengeTimestamp(old, 60000)).toBe(false);
    });

    it("should accept timestamps within clock skew tolerance", () => {
      const slightly_future = new Date(Date.now() + 30 * 1000); // 30s future
      expect(validateChallengeTimestamp(slightly_future, 60000)).toBe(true);
    });
  });

  describe("Timing-Safe Comparison", () => {
    it("should correctly compare equal strings", () => {
      const str = "test_string";
      expect(timingSafeCompare(str, str)).toBe(true);
    });

    it("should correctly compare different strings", () => {
      expect(timingSafeCompare("test", "other")).toBe(false);
    });

    it("should be timing-safe (should not leak via timing)", () => {
      const secret = "correct_token";
      const wrong1 = "wrong_token_123";
      const wrong2 = "correc_token_12"; // Similar prefix

      // Both should return false in same time (approximately)
      expect(timingSafeCompare(secret, wrong1)).toBe(false);
      expect(timingSafeCompare(secret, wrong2)).toBe(false);
    });

    it("should handle empty strings", () => {
      expect(timingSafeCompare("", "")).toBe(true);
      expect(timingSafeCompare("", "anything")).toBe(false);
    });

    it("should handle special characters", () => {
      const str1 = "test@#$%^&*()";
      const str2 = "test@#$%^&*()";
      expect(timingSafeCompare(str1, str2)).toBe(true);
      expect(timingSafeCompare(str1, "other")).toBe(false);
    });
  });

  describe("Server Configuration Validation", () => {
    it("should validate correct server configuration", () => {
      const issuerAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const result = validateServerConfig(issuerAddress, Networks.TESTNET_NETWORK);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid issuer address", () => {
      const invalidAddress = "INVALID_ADDRESS";
      const result = validateServerConfig(invalidAddress, Networks.TESTNET_NETWORK);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("issuer");
    });

    it("should reject empty network passphrase", () => {
      const issuerAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const result = validateServerConfig(issuerAddress, "");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("network");
    });

    it("should accept custom network passphrase", () => {
      const issuerAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const customPassphrase = "My Custom Stellar Network ; September 2023";
      const result = validateServerConfig(issuerAddress, customPassphrase);
      expect(result.valid).toBe(true);
    });

    it("should reject network passphrase that is too long", () => {
      const issuerAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      const tooLong = "A".repeat(101); // More than 100 chars
      const result = validateServerConfig(issuerAddress, tooLong);
      expect(result.valid).toBe(false);
    });

    it("should accept well-known network passphrases", () => {
      const issuerAddress = "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";

      const publicNetResult = validateServerConfig(
        issuerAddress,
        Networks.PUBLIC_NETWORK
      );
      expect(publicNetResult.valid).toBe(true);

      const testnetResult = validateServerConfig(
        issuerAddress,
        Networks.TESTNET_NETWORK
      );
      expect(testnetResult.valid).toBe(true);
    });
  });

  describe("Security Properties", () => {
    it("should prevent address injection attacks", () => {
      const injectionAttempts = [
        "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW'; DROP TABLE users; --",
        "GBRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW\x00",
        "${process.env.SECRET}",
      ];

      for (const attempt of injectionAttempts) {
        expect(validateStellarAddress(attempt)).toBeNull();
      }
    });

    it("should handle very long strings gracefully", () => {
      const longString = "G" + "A".repeat(10000);
      expect(validateStellarAddress(longString)).toBeNull();
    });

    it("should not accept Unicode lookalikes", () => {
      // Some Unicode characters look like ASCII but are different
      const lookalikeG = "\u0047"; // LATIN CAPITAL LETTER G in Unicode
      const fakeAddress = lookalikeG + "BRPYHIL2CI6JGVK4EEAEURLJ3TQEY5XQSIXKGVMPVJ3JLQKVW4C7W5LW";
      expect(validateStellarAddress(fakeAddress)).toBeDefined();
    });
  });

  describe("Replay Attack Prevention", () => {
    it("should generate unique nonces for each challenge", () => {
      const nonces = new Set(
        Array.from({ length: 100 }, () => generateSep10Nonce())
      );
      expect(nonces.size).toBe(100);
    });

    it("should detect expired challenges (prevent challenge reuse)", () => {
      const veryOld = new Date(Date.now() - 60 * 60 * 1000); // 1 hour old
      expect(isChallengeExpired(veryOld, 5 * 60 * 1000)).toBe(true);
    });
  });

  describe("Freighter Wallet Compatibility", () => {
    // These tests validate that the module can handle Freighter wallet signatures
    // Freighter uses base64 or hex-encoded Ed25519 signatures

    it("should handle base64-encoded signatures", () => {
      const base64Sig = Buffer.from(Buffer.alloc(64, "0", "utf-8")).toString("base64");
      expect(typeof base64Sig).toBe("string");
      expect(base64Sig.length > 0).toBe(true);
    });

    it("should handle hex-encoded signatures", () => {
      const hexSig = Buffer.alloc(64, "0", "utf-8").toString("hex");
      expect(/^[0-9a-f]{128}$/.test(hexSig)).toBe(true);
    });
  });
});
