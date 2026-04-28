// Ambient declarations for @creit.tech/stellar-wallets-kit v2.0.x
// Mirrors the actual package types so callers compile without casts.

declare module "@creit.tech/stellar-wallets-kit" {
  export enum Networks {
    PUBLIC = "Public Global Stellar Network ; September 2015",
    TESTNET = "Test SDF Network ; September 2015",
    FUTURENET = "Test SDF Future Network ; October 2022",
    SANDBOX = "Local Sandbox Stellar Network ; September 2022",
    STANDALONE = "Standalone Network ; February 2017",
  }

  export enum KitEventType {
    STATE_UPDATED = "STATE_UPDATE",
    WALLET_SELECTED = "WALLET_SELECTED",
    DISCONNECT = "DISCONNECT",
  }

  export interface ISupportedWallet {
    id: string;
    name: string;
    type: string;
    isAvailable: boolean;
    isPlatformWrapper: boolean;
    icon: string;
    url: string;
  }

  export interface ModuleInterface {
    moduleType: string;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
    getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    disconnect?(): Promise<void>;
  }

  export interface SwkAppTheme {
    "background": string;
    "background-secondary": string;
    "foreground-strong": string;
    "foreground": string;
    "foreground-secondary": string;
    "primary": string;
    "primary-foreground": string;
    "transparent": string;
    "lighter": string;
    "light": string;
    "light-gray": string;
    "gray": string;
    "danger": string;
    "border": string;
    "shadow": string;
    "border-radius": string;
    "font-family": string;
  }

  export const SwkAppDarkTheme: SwkAppTheme;
  export const SwkAppLightTheme: SwkAppTheme;

  export interface StellarWalletsKitInitParams {
    modules: ModuleInterface[];
    selectedWalletId?: string;
    network?: Networks;
    theme?: SwkAppTheme;
  }

  export type KitEventStateUpdated = {
    eventType: KitEventType.STATE_UPDATED;
    payload: { address: string | undefined; networkPassphrase: string };
  };
  export type KitEventWalletSelected = {
    eventType: KitEventType.WALLET_SELECTED;
    payload: { id: string | undefined };
  };
  export type KitEventDisconnected = {
    eventType: KitEventType.DISCONNECT;
    payload: Record<PropertyKey, never>;
  };

  export class StellarWalletsKit {
    static init(params: StellarWalletsKitInitParams): void;
    static get selectedModule(): ModuleInterface;
    static setWallet(id: string): void;
    static setNetwork(network: Networks): void;
    static setTheme(theme?: SwkAppTheme): void;
    static getAddress(): Promise<{ address: string }>;
    static getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    static signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    static signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    static signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
    static disconnect(): Promise<void>;
    static refreshSupportedWallets(): Promise<ISupportedWallet[]>;
    static authModal(params?: { container?: HTMLElement }): Promise<{ address: string }>;
    static profileModal(params?: { container?: HTMLElement }): Promise<void>;
    static on(type: KitEventType.STATE_UPDATED, callback: (event: KitEventStateUpdated) => void): () => void;
    static on(type: KitEventType.WALLET_SELECTED, callback: (event: KitEventWalletSelected) => void): () => void;
    static on(type: KitEventType.DISCONNECT, callback: (event: KitEventDisconnected) => void): () => void;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/freighter" {
  import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
  export class FreighterModule implements ModuleInterface {
    constructor();
    moduleType: string;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
    getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    disconnect?(): Promise<void>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/albedo" {
  import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
  export class AlbedoModule implements ModuleInterface {
    constructor();
    moduleType: string;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
    getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    disconnect?(): Promise<void>;
  }
}

declare module "@creit.tech/stellar-wallets-kit/modules/xbull" {
  import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
  export class xBullModule implements ModuleInterface {
    constructor();
    moduleType: string;
    productId: string;
    productName: string;
    productUrl: string;
    productIcon: string;
    isAvailable(): Promise<boolean>;
    getAddress(params?: { path?: string; skipRequestAccess?: boolean }): Promise<{ address: string }>;
    signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>;
    signAuthEntry(authEntry: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedAuthEntry: string; signerAddress?: string }>;
    signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }): Promise<{ signedMessage: string; signerAddress?: string }>;
    getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
    disconnect?(): Promise<void>;
  }
}
