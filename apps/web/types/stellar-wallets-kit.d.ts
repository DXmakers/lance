// Ambient module declaration for @creit.tech/stellar-wallets-kit v2.
// Required because v2's package.json is missing a `types` field.

declare module "@creit.tech/stellar-wallets-kit" {
  export enum Networks {
    PUBLIC = "Public Global Stellar Network ; September 2015",
    TESTNET = "Test SDF Network ; September 2015",
    FUTURENET = "Test SDF Future Network ; October 2022",
    SANDBOX = "Local Sandbox Stellar Network ; September 2022",
    STANDALONE = "Standalone Network ; February 2017",
  }

  export interface WalletModule {
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean> | boolean;
    getAddress(params?: { skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signMessage(
      message: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedMessage: string; signerAddress?: string }>;
  }

  export interface StellarWalletsKitOptions {
    network: Networks;
    selectedWalletId?: string;
    modules?: WalletModule[];
    [key: string]: unknown;
  }

  export interface AuthModalOptions {
    container?: HTMLElement;
    [key: string]: unknown;
  }

  export class StellarWalletsKit {
    static init(options: StellarWalletsKitOptions): void;
    static setWallet(id: string): void;
    static setNetwork(network: Networks): void;
    static authModal(options?: AuthModalOptions): Promise<{ address: string }>;
    static getAddress(): Promise<{ address: string }>;
    static getNetwork(): Promise<{ network: string }>;
    static signTransaction(
      xdr: string,
      options?: { networkPassphrase?: string; [key: string]: unknown },
    ): Promise<{ signedTxXdr: string }>;
    static signMessage(
      message: string,
      options?: { networkPassphrase?: string; [key: string]: unknown },
    ): Promise<{ signedMessage: string }>;
    static disconnect(): Promise<void>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/freighter" {
  import type { WalletModule } from "@creit.tech/stellar-wallets-kit";

  export class FreighterModule implements WalletModule {
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(params?: { skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signMessage(
      message: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedMessage: string; signerAddress?: string }>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/albedo" {
  import type { WalletModule } from "@creit.tech/stellar-wallets-kit";

  export class AlbedoModule implements WalletModule {
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signMessage(
      message: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedMessage: string; signerAddress?: string }>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/xbull" {
  import type { WalletModule } from "@creit.tech/stellar-wallets-kit";

  export class xBullModule implements WalletModule {
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signMessage(
      message: string,
      options?: { address?: string; networkPassphrase?: string },
    ): Promise<{ signedMessage: string; signerAddress?: string }>;
  }
}
