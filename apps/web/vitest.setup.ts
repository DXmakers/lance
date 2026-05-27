import "@testing-library/jest-dom/vitest";

// Some libs reference a lowercase `localstorage` global — mirror it to the
// standard `localStorage` provided by jsdom so tests don't crash.
(globalThis as unknown as Record<string, unknown>).localstorage = (globalThis as unknown as Record<string, unknown>).localStorage;

import { vi } from "vitest";

// Mock the wallets kit and its modules to avoid running native or environment-specific
// code during unit tests. Tests only need the public API surface.
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
	StellarWalletsKit: {
		init: () => {},
		authModal: async () => ({ address: "GMOCKADDRESS" }),
		getAddress: async () => ({ address: "GMOCKADDRESS" }),
		signTransaction: async (xdr: string) => xdr,
		signMessage: async () => "signed",
		disconnect: async () => {},
		setNetwork: () => {},
	},
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
	FreighterModule: function FreighterModule() {},
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({
	AlbedoModule: function AlbedoModule() {},
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({
	xBullModule: function xBullModule() {},
}));

// Mock the local toast implementation used across the app so tests can spy on
// toast calls (loading, update, dismiss, success, error, info).
vi.mock("@/lib/toast", () => {
	const mock = {
		loading: vi.fn(() => ({ id: "mock-toast" })),
		update: vi.fn(),
		dismiss: vi.fn(),
		dismissAll: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	};
	return { toast: mock };
});
