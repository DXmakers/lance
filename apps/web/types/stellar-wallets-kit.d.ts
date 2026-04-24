// Ambient module declaration for @creit.tech/stellar-wallets-kit v2.
// Covers both the instance API (v2 compat) and the static-factory API
// introduced in the kryputh rewrite so that all callers compile cleanly.

declare module "@creit.tech/stellar-wallets-kit" {
  export enum Networks {
    PUBLIC = "Public Global Stellar Network ; September 2015",
    TESTNET = "Test SDF Network ; September 2015",
    FUTURENET = "Test SDF Future Network ; October 2022",
  }

  export interface ISupportedWallet {
    id: string;
    name: string;
    type?: string;
    icon: string;
    isAvailable: boolean;
    url?: string;
  }

  export interface OpenModalOptions {
    onWalletSelected?: (option: ISupportedWallet) => void | Promise<void>;
    onClosed?: (err?: Error) => void;
    modalTitle?: string;
    notAvailableText?: string;
    [key: string]: unknown;
  }

  export interface StellarWalletsKitOptions {
    network: Networks;
    selectedWalletId?: string;
    modules?: unknown[];
    [key: string]: unknown;
  }

  export class StellarWalletsKit {
    // Instance API (v2 compat)
    constructor(options: StellarWalletsKitOptions);
    openModal(options?: OpenModalOptions): void;
    closeModal(): void;
    setWallet(walletId: string): void;
    getSupportedWallets(): Promise<ISupportedWallet[]>;
    getAddress(): Promise<{ address: string }>;
    signTransaction(
      xdr: string,
      options?: Record<string, unknown>,
    ): Promise<{ signedTxXdr: string }>;
    disconnect(): Promise<void>;

    // Static factory / auth-modal API
    static init(options: StellarWalletsKitOptions): void;
    static authModal(options?: OpenModalOptions): Promise<{ address: string }>;
    static getAddress(): Promise<{ address: string }>;
    static setNetwork(network: Networks): void;
    static signTransaction(
      xdr: string,
      options?: Record<string, unknown>,
    ): Promise<{ signedTxXdr?: string; signedXDR?: string }>;
    static signMessage(
      message: string,
      options?: Record<string, unknown>,
    ): Promise<{ signedMessage?: string; signedXDR?: string }>;
    static disconnect(): Promise<void>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/freighter" {
  export class FreighterModule {
    constructor();
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/albedo" {
  export class AlbedoModule {
    constructor();
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/xbull" {
  export class xBullModule {
    constructor();
  }
}
