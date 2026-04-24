import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useAccountChangeListener, useNetworkMismatchListener, useWalletConnectionState } from "../use-account-listener";
import * as stellarModule from "@/lib/stellar";

vi.mock("@/lib/stellar", () => ({
  getConnectedWalletAddress: vi.fn(),
  getWalletsKit: vi.fn(() => ({
    getAddress: vi.fn(),
    setNetwork: vi.fn(),
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
  })),
}));

const mockUseWalletStore = {
  address: "GABC1234567890",
  walletId: "freighter",
  network: "TESTNET" as const,
  disconnect: vi.fn(),
  setConnection: vi.fn(),
  setStatus: vi.fn(),
};

vi.mock("@/lib/store/use-wallet-store", () => ({
  useWalletStore: () => mockUseWalletStore,
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useAccountChangeListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("monitors account changes when enabled and address exists", async () => {
    const onAccountChanged = vi.fn();
    vi.mocked(stellarModule.getConnectedWalletAddress).mockResolvedValue("GABC1234567890");

    const { result } = renderHook(
      () =>
        useAccountChangeListener({
          onAccountChanged,
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    expect(result.current.isMonitoring).toBe(true);
  });

  it("does not monitor when enabled is false", async () => {
    const { result } = renderHook(
      () =>
        useAccountChangeListener({
          enabled: false,
        }),
      { wrapper: Wrapper }
    );

    expect(result.current.isMonitoring).toBe(false);
  });

  it("does not monitor when address is null", async () => {
    const originalAddress = mockUseWalletStore.address;
    mockUseWalletStore.address = null;

    const { result } = renderHook(
      () =>
        useAccountChangeListener({
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    expect(result.current.isMonitoring).toBe(false);

    mockUseWalletStore.address = originalAddress;
  });

  it("detects account change and calls callback", async () => {
    const onAccountChanged = vi.fn();
    vi.mocked(stellarModule.getConnectedWalletAddress)
      .mockResolvedValueOnce("GABC1234567890")
      .mockResolvedValueOnce("GDIFFERENT123456789")
      .mockResolvedValueOnce("GDIFFERENT123456789")
      .mockResolvedValueOnce("GDIFFERENT123456789");

    renderHook(
      () =>
        useAccountChangeListener({
          onAccountChanged,
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(onAccountChanged).toHaveBeenCalledWith("GDIFFERENT123456789");
  });

  it("handles storage event for wallet disconnect", async () => {
    const onAccountChanged = vi.fn();

    renderHook(
      () =>
        useAccountChangeListener({
          onAccountChanged,
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "wallet_address",
          newValue: null,
        })
      );
    });

    expect(mockUseWalletStore.disconnect).toHaveBeenCalled();
    expect(onAccountChanged).toHaveBeenCalledWith(null);
  });

  it("handles storage event for wallet change in another tab", async () => {
    const onAccountChanged = vi.fn();

    renderHook(
      () =>
        useAccountChangeListener({
          onAccountChanged,
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "wallet_address",
          newValue: "GNEWADDRESS123456789",
        })
      );
    });

    expect(onAccountChanged).toHaveBeenCalledWith("GNEWADDRESS123456789");
  });
});

describe("useNetworkMismatchListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns expected network from store", async () => {
    const { result } = renderHook(
      () =>
        useNetworkMismatchListener({
          enabled: true,
        }),
      { wrapper: Wrapper }
    );

    expect(result.current.expectedNetwork).toBe("TESTNET");
  });

  it("does not check when disabled", async () => {
    const { result } = renderHook(
      () =>
        useNetworkMismatchListener({
          enabled: false,
          checkInterval: 1000,
        }),
      { wrapper: Wrapper }
    );

    expect(result.current.isChecking).toBe(false);
  });
});

describe("useWalletConnectionState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct connection state", async () => {
    mockUseWalletStore.address = "GABC1234567890";
    mockUseWalletStore.network = "TESTNET";
    Object.defineProperty(mockUseWalletStore, "status", {
      value: "connected",
      writable: true,
    });

    const { result } = renderHook(() => useWalletConnectionState(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.address).toBe("GABC1234567890");
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.network).toBe("TESTNET");
  });

  it("returns disconnected state when address is null", async () => {
    mockUseWalletStore.address = null;
    Object.defineProperty(mockUseWalletStore, "status", {
      value: "disconnected",
      writable: true,
    });

    const { result } = renderHook(() => useWalletConnectionState(), {
      wrapper: Wrapper,
    });

    expect(result.current.isConnected).toBe(false);
  });
});

describe("Wallet address validation", () => {
  it("validates Stellar address format", () => {
    const isValidAddress = (address: string) => /^[G][A-Z2-7]{55}$/.test(address);

    expect(isValidAddress("GABC1234567890")).toBe(false);
    expect(isValidAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(true);
    expect(isValidAddress("")).toBe(false);
  });
});