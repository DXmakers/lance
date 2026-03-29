// Ambient module declaration for @creit.tech/stellar-wallets-kit v2.
// Required because v2's package.json is missing a `"types"` field.

declare module "@creit.tech/stellar-wallets-kit" {
  export enum Networks {
    PUBLIC = "Public Global Stellar Network ; September 2015",
    TESTNET = "Test SDF Network ; September 2015",
    FUTURENET = "Test SDF Future Network ; October 2022",
  }

  export interface StellarWalletsKitOptions {
    network: Networks;
    selectedWalletId?: string;
    [key: string]: unknown;
  }

  export class StellarWalletsKit {
    constructor(options: StellarWalletsKitOptions);
    openModal(options?: {
      onWalletSelected: (wallet: { id: string; name: string }) => void;
    }): void;
    closeModal(): void;
    setWallet(id: string): void;
    getAddress(): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: Record<string, unknown>,
    ): Promise<{ signedTxXdr: string }>;
    disconnect(): Promise<void>;
  }
}
