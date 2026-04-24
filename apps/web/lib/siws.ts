import { signMessage } from "@/lib/stellar";

import { APP_STELLAR_NETWORK, assertValidStellarAddress, signTransaction, Networks } from "./stellar";

export interface SIWSMessage {
  domain: string;
export interface SIWSPayload {
  address: string;
  domain: string;
  nonce: string;
  issuedAt: string;
}

export interface SIWSResponse {
  message: SIWSPayload;
  signature: string;
  publicKey: string;
}

export class SIWSService {
  /**
   * Formats the SIWS payload into a readable message for signing.
   */
  static generateMessage(payload: SIWSPayload): string {
    const { address, domain, nonce, issuedAt } = payload;
    return `${domain} wants you to sign in with your Stellar account:\n${address}\n\nURI: https://${domain}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  }

  /**
   * Builds a SIWS message and signs it with the active wallet.
   * Backend verification can then validate the returned payload.
   */
  static async signIn(address: string): Promise<SIWSResponse> {
    const domain =
      typeof window !== "undefined" ? window.location.host : "localhost";

    const message: SIWSPayload = {
      address,
      domain,
      nonce: generateNonce(),
      issuedAt: new Date().toISOString(),
    };

    const signature = await signMessage(this.generateMessage(message));

    return {
      message,
      signature,
      publicKey: address,
    };
  }
}

  /**
   * Sign message using wallet (simplified implementation)
   */
  private static async signMessageWithWallet(message: string): Promise<string> {
    // For now, we'll create a simple mock signature
    // In a real implementation, you'd use the wallet's signing API
    // This is a placeholder to avoid Stellar SDK compatibility issues
    
    try {
      // Use the existing signTransaction function with a mock transaction
      // This is a workaround for the Stellar SDK Account class issues
      const mockXdr = "AAAAAgAAAAA="; // Minimal mock XDR
      await signTransaction(mockXdr);
      
      // For demo purposes, return a simple hash of the message
      // In production, this would be the actual wallet signature
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const hashArray = Array.from(data);
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      return hashHex;
    } catch (error) {
      console.error('Failed to sign message with wallet:', error);
      throw new Error('Wallet signing failed');
    }
  }

  /**
   * Verify SIWS authentication response
   */
  static async verify(response: SIWSResponse): Promise<boolean> {
    return await SIWSChallenge.verifySignature(response);
  }
export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Returns the raw message string for the wallet to sign.
 */
export function buildSiwsMessage(payload: SIWSPayload): string {
  return SIWSService.generateMessage(payload);
}
