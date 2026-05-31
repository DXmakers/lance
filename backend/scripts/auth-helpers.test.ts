import assert from "assert";
import crypto from "crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  decodeSignature,
  isChallengeExpired,
  normalizeStellarAddress,
  verifyStellarSignature,
} from "../src/routes/auth";

const keypair = Keypair.random();
const address = keypair.publicKey();
const challenge = `Lance wants you to sign in with your Stellar account:\n${address}\n\nNonce: test-nonce`;
const messageHash = crypto.createHash("sha256").update(Buffer.from(`Stellar Signed Message:\n${challenge}`)).digest();
const signature = keypair.sign(messageHash).toString("base64");

assert.strictEqual(normalizeStellarAddress(address), address, "valid Stellar G-address should normalize");
assert.strictEqual(normalizeStellarAddress(`${address.slice(0, -1)}A`), null, "bad checksum should be rejected");
assert.strictEqual(decodeSignature(signature)?.length, 64, "SEP-53 signatures are 64 raw Ed25519 bytes");
assert.strictEqual(verifyStellarSignature(address, challenge, signature), true, "valid SEP-53 signature should verify");
assert.strictEqual(verifyStellarSignature(address, `${challenge}!`, signature), false, "tampered challenge should fail");
assert.strictEqual(isChallengeExpired(new Date(Date.now() - 1_000)), true, "past challenge should be expired");
assert.strictEqual(isChallengeExpired(new Date(Date.now() + 60_000)), false, "future challenge should remain active");

console.log("auth helper mockups passed");
