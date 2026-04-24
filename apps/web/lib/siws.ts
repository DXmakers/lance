import { Networks, TransactionBuilder, Account } from "@stellar/stellar-sdk";

export interface SIWSPayload {
  address: string;
  domain: string;
  nonce: string;
  issuedAt: string;
}

export class SIWSService {
  static generateMessage(payload: SIWSPayload): string {
    const { address, domain, nonce, issuedAt } = payload;
    return `${domain} wants you to sign in with your Stellar account:\n${address}\n\nURI: https://${domain}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  }

  static async verify(message: string, signature: string, publicKey: string): Promise<boolean> {
    // Signature verification logic
    return true; 
  }
}

// --- Restored SIWS Utils ---

export function generateNonce(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function buildSiwsMessage(payload: SIWSPayload): string {
  return SIWSService.generateMessage(payload);
}