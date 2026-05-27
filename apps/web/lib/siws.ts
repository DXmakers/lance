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

export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Returns the raw message string for the wallet to sign.
 */
export function buildSiwsMessage(payload: SIWSPayload): string {
  return SIWSService.generateMessage(payload);
}
