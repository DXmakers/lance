import { test as base } from "@playwright/test";

const PUBLIC_KEY = "GCFXJ4W3A3Q4KPL6WJABDETTESTMOCKPUBKEYQWERTY123456";

type WalletFixture = {
  walletPublicKey: string;
};

export const test = base.extend<WalletFixture>({
  walletPublicKey: [PUBLIC_KEY, { option: true }],
  page: async ({ page, walletPublicKey }, use) => {
    await page.addInitScript(({ publicKey }) => {
      const signPayload = async (xdr: string) => {
        return {
          signedTxXdr: `signed:${xdr}:${publicKey}`,
        };
      };

      const walletApi = {
        isConnected: async () => true,
        getPublicKey: async () => publicKey,
        signTransaction: signPayload,
      };

      class MockWalletAdapter {
        async connect() {
          return publicKey;
        }

        async signTransaction(xdr: string) {
          return `signed:${xdr}:${publicKey}`;
        }

        async disconnect() {
          return undefined;
        }
      }

      Object.defineProperty(window, "freighterApi", {
        configurable: true,
        value: walletApi,
      });

      window.__LANCE_E2E_WALLET__ = new MockWalletAdapter();
    }, { publicKey: walletPublicKey });

    await use(page);
  },
});

export { expect } from "@playwright/test";
