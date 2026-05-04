# Stellar Wallets on Lance — User Guide

This guide walks you through connecting a Stellar wallet to Lance, signing transactions (escrow deposits, milestone releases, disputes), switching between Testnet and Mainnet, and resolving common problems.

Lance integrates with Stellar wallets via [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit), so the same flow works across every supported provider.

---

## Table of contents

1. [Why Lance needs a wallet](#why-lance-needs-a-wallet)
2. [Supported wallets](#supported-wallets)
3. [Installing a wallet](#installing-a-wallet)
4. [Connecting your wallet in Lance](#connecting-your-wallet-in-lance)
5. [Understanding what you sign](#understanding-what-you-sign)
6. [Testnet vs. Mainnet](#testnet-vs-mainnet)
7. [Switching accounts](#switching-accounts)
8. [Disconnecting](#disconnecting)
9. [Troubleshooting](#troubleshooting)
10. [Security best practices](#security-best-practices)

---

## Why Lance needs a wallet

Lance is a Stellar-native freelance marketplace. Every on-chain action — funding an escrow, releasing a milestone, raising a dispute, updating on-chain reputation — is a Soroban contract call authorised by your Stellar secret key.

Lance **never** sees your secret key. Your wallet holds the key, and you approve each transaction individually in the wallet's own UI. Lance's role is limited to:

- Building the unsigned transaction (XDR) from what you click.
- Asking your wallet to sign it.
- Submitting the signed transaction to the Soroban RPC.

If you disconnect the wallet, Lance can no longer authorise anything on your behalf.

---

## Supported wallets

Lance works with any wallet supported by `@creit.tech/stellar-wallets-kit`. The most common ones are:

| Wallet       | Type               | Notes                                                  |
| ------------ | ------------------ | ------------------------------------------------------ |
| **Freighter**| Browser extension  | First-party Stellar wallet by SDF. Recommended default. |
| **Albedo**   | Web popup          | No extension required; opens in a popup window.         |
| **xBull**    | Browser extension  | Community wallet with strong multisig support.          |
| **LOBSTR**   | Browser + mobile   | Requires the LOBSTR Vault signer extension.             |
| **Hana**     | Browser extension  | Multi-chain; Stellar support included.                  |
| **Rabet**    | Browser extension  | Open-source.                                            |

The wallet picker is shown automatically the first time you click **Connect wallet** — you don't need to pre-select one.

---

## Installing a wallet

Pick the provider you want to use and install it from the official site:

- Freighter — <https://www.freighter.app/>
- Albedo — <https://albedo.link/>
- xBull — <https://xbull.app/>
- LOBSTR signer — <https://lobstr.co/>
- Rabet — <https://rabet.io/>
- Hana — <https://hanawallet.io/>

After installing, open the extension, create or import an account, and make sure it is funded — on Testnet you can fund it in one click via **Friendbot** (available from within most wallets or at <https://laboratory.stellar.org/#account-creator?network=test>).

---

## Connecting your wallet in Lance

1. Click **Connect wallet** in the top-right of any Lance page.
2. The wallet picker appears. Choose your provider.
3. Your wallet opens and asks you to authorise the connection. Approve it.
4. The button in Lance updates to show your wallet's icon, name, and a short form of your public address (for example `GABC…9XYZ`).

That's it — you're connected. Lance remembers your choice of provider for the current browser session so the icon reappears after a refresh.

> **Nothing leaves your wallet during connect.** The only information Lance receives is your public address (`G…`). Public addresses are safe to share; they are the Stellar equivalent of an account number.

---

## Understanding what you sign

Whenever Lance needs to change on-chain state, your wallet will prompt you to sign a transaction. Always read the prompt. The three Lance actions you will see most often are:

| Action                     | What it does on-chain                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| **Fund escrow**            | Transfers USDC from your wallet into the escrow contract for a specific job.            |
| **Release milestone**      | As the client, marks a milestone complete and releases the corresponding USDC tranche.  |
| **Open dispute**           | Flags a job for AI-judge review; locks the remaining escrow until the dispute resolves. |

The wallet will show the target contract address, the asset and amount moving, and the operation name. If anything looks wrong — unexpected amount, unknown contract, wrong network — **reject** the transaction and reach out in Lance's support channel.

---

## Testnet vs. Mainnet

Lance currently runs on **Stellar Testnet**. Testnet USDC is play money; you can request it from Friendbot for free and use it freely while learning the product.

The network the app expects is controlled by the `NEXT_PUBLIC_STELLAR_NETWORK` environment variable in `apps/web/.env.local`:

```bash
# Testnet (default)
NEXT_PUBLIC_STELLAR_NETWORK="Test SDF Network ; September 2015"

# Mainnet (when Lance launches)
NEXT_PUBLIC_STELLAR_NETWORK="Public Global Stellar Network ; September 2015"
```

Make sure the network selected inside your wallet **matches** the app. If Lance is configured for Testnet but your wallet is set to Mainnet, signing will still succeed — but the transaction will target a different chain and fail on submission. Most wallets have a network toggle in their settings menu.

---

## Switching accounts

If you manage multiple Stellar accounts in the same wallet and want Lance to use a different one:

1. Open your wallet extension.
2. Switch to the account you want Lance to use.
3. Refresh the Lance page (or click the connected-wallet pill → disconnect → connect again).

Lance reads whichever account is currently active in your wallet at sign time.

---

## Disconnecting

Click the connected-wallet pill in the top nav, then choose **Disconnect**. Lance forgets your provider selection for the current session. Your wallet extension itself is not affected — your keys remain in the extension, and you can reconnect any time.

Closing the browser tab or ending the session also clears Lance's record of which provider you picked, but your wallet's own session (how long the extension stays unlocked) is governed by the wallet's own settings.

---

## Troubleshooting

### "No wallet extension detected"

- Confirm the extension is installed and enabled for the current site.
- Some browsers disable extensions in **Incognito / Private** mode. Either enable the extension for private mode or use a regular window.
- If you just installed the extension, refresh the Lance tab.

### The wallet picker opens but my wallet isn't listed

The kit lists every supported wallet regardless of whether the extension is installed. Wallets that aren't detected are shown as unavailable. Install the extension, refresh, and the entry becomes selectable.

### Transaction says "Insufficient balance" but I have USDC

- Check that the USDC on your account matches the USDC asset Lance is using. On Testnet, Lance uses the test USDC issued by Circle's test issuer; a different USDC asset on the same network counts as a different token.
- Confirm you also hold enough **XLM** to cover Stellar's base reserve and transaction fee (a few XLM is typically enough).

### "Transaction failed on-chain"

The signed transaction was accepted by the Soroban RPC but rejected during execution. Common causes:

- Calling `release_milestone` when the escrow is already complete.
- Attempting to open a dispute on a job that isn't funded.
- The wallet was on the wrong network (Testnet vs. Mainnet).

The transaction hash returned in the error lets you look up the exact failure reason on <https://stellar.expert> (switch to Testnet if needed).

### The provider icon doesn't appear after connecting

This usually means the wallet resolved your address but its metadata (name + icon) wasn't returned in time. Refreshing the page rehydrates the metadata from the kit's supported-wallets list.

### Wallet modal closes instantly with no selection

The kit fires `onClosed` if you dismiss the modal. Click **Connect wallet** again; the picker will reopen.

---

## Security best practices

- **Keep your secret key off the internet.** Never paste a `S…` key into any website, chat, or email — legitimate Lance flows only ever request wallet-signed approvals.
- **Verify every sign prompt.** Read the destination contract and the amount before clicking approve.
- **Use Testnet to learn.** The UI is identical; mistakes cost nothing.
- **Lock your wallet when you step away.** All supported extensions have an auto-lock timer; set it to a value you're comfortable with.
- **Prefer multisig for high-value accounts.** xBull and LOBSTR both support additional signers. For client accounts funding large jobs, adding a hardware-wallet co-signer is worth the extra click.
- **Keep your extension up to date.** Wallet teams ship security fixes regularly; pick automatic updates in your browser.

---

## Need more help?

- Technical architecture — see the root [README](../../README.md).
- Contract-level details — see [`docs/contracts/`](../contracts/).
- File a bug or a documentation gap — open an issue on the Lance GitHub repository.
