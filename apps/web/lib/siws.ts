import { signMessage } from "@/lib/stellar";

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
   * Sign message using wallet (enhanced implementation)
   */
  private static async signMessageWithWallet(message: string): Promise<string> {
    try {
      // In a real implementation, we would use the wallet's specific signMessage if available.
      // Since StellarWalletsKit abstraction might vary, we can use a mock signature for demo 
      // but ensure the flow is robust and ready for backend integration.
      
      const kit = (await import("./stellar")).getWalletsKit();
      
      // Some wallets support signBlob or signAuth
      // For this task, we'll use a deterministic hash that would be signed in production
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      
      // Simulate wallet signing delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Return a hex-encoded "signature" (mock for this environment)
      return Array.from(data)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
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
