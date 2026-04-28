# Requirements Document

## Introduction

The Transaction History View feature provides users with a dedicated, paginated interface to browse, filter, and inspect every on-chain transaction associated with their connected Stellar wallet. It surfaces the full Soroban transaction lifecycle — escrow deposits, milestone releases, bid submissions, and dispute resolutions — in a developer-friendly yet accessible UI. The view integrates with the existing `soroban-pipeline`, `use-tx-status-store`, and Horizon/Soroban RPC layers already present in the codebase, adding a persistent, queryable history layer on top of the live pipeline tracker.

Security and data integrity are the highest priorities: raw XDR and simulation diagnostics are exposed only in non-production environments, all cryptographic operations remain delegated to the connected wallet provider, and no private key material is ever handled by the application layer.

---

## Glossary

- **Transaction_History_View**: The React page and associated components that display the paginated list of past on-chain transactions for the connected wallet.
- **Transaction_Record**: A single entry in the history representing one confirmed (or failed) Soroban transaction, including its hash, type, status, fee, timestamp, and optional XDR/simulation data.
- **Pipeline**: The five-step Soroban transaction lifecycle: Build → Simulate → Sign → Submit → Confirm, implemented in `soroban-pipeline.ts`.
- **XDR**: External Data Representation — the binary serialisation format used by the Stellar network for transactions and results.
- **Simulation_Log**: The fee, CPU instruction count, memory byte count, and ledger I/O metrics returned by the Soroban RPC preflight step.
- **Wallet_Provider**: The browser extension or in-page wallet (Freighter, Albedo, xBull) accessed through `@creit.tech/stellar-wallets-kit` that holds the user's private key and signs transactions.
- **Soroban_RPC**: The JSON-RPC endpoint (`NEXT_PUBLIC_SOROBAN_RPC_URL`) used for transaction simulation, submission, and status polling.
- **Horizon_Server**: The REST API endpoint (`NEXT_PUBLIC_HORIZON_URL`) used for account and payment history queries.
- **Explorer_Link**: A URL to `stellar.expert` (testnet or mainnet) that allows external verification of a transaction hash.
- **Sequence_Number**: A monotonically increasing counter on a Stellar account used to prevent transaction replay; a mismatch causes `tx_bad_seq` errors.
- **Stroops**: The smallest unit of XLM (1 XLM = 10,000,000 stroops), used for fee representation.
- **Dev_Mode**: Any environment where `NODE_ENV !== "production"`, in which additional diagnostic data (raw XDR, simulation logs) is rendered.

---

## Requirements

### Requirement 1: Transaction History Data Fetching

**User Story:** As a connected wallet user, I want to load my complete on-chain transaction history, so that I can audit every action I have taken on the platform.

#### Acceptance Criteria

1. WHEN the Transaction_History_View mounts and a wallet address is available, THE Transaction_History_View SHALL fetch Transaction_Records from the Horizon_Server for the connected wallet address.
2. WHEN the Horizon_Server returns a paginated response, THE Transaction_History_View SHALL display the first page of Transaction_Records and provide pagination controls to navigate to subsequent pages.
3. IF the Horizon_Server request fails, THEN THE Transaction_History_View SHALL display a high-contrast error message that includes the failure reason and a retry action.
4. WHILE a fetch is in progress, THE Transaction_History_View SHALL display a skeleton loading state in place of the Transaction_Record list.
5. WHEN no wallet address is connected, THE Transaction_History_View SHALL display an empty state prompting the user to connect their wallet.

---

### Requirement 2: Transaction Record Display

**User Story:** As a user reviewing my history, I want each transaction entry to show its type, status, fee, and timestamp at a glance, so that I can quickly identify relevant operations.

#### Acceptance Criteria

1. THE Transaction_History_View SHALL render each Transaction_Record with the following fields: transaction hash (truncated, monospace), operation type label (e.g. "Escrow Deposit", "Milestone Release", "Bid Submit", "Dispute Open"), status badge ("Confirmed" or "Failed"), fee in XLM (converted from Stroops), and a human-readable relative timestamp.
2. WHEN a Transaction_Record has a confirmed status, THE Transaction_History_View SHALL render an Explorer_Link that opens `stellar.expert` for the corresponding transaction hash in a new browser tab.
3. THE Transaction_History_View SHALL use monospace typography for all raw hash and XDR values to maintain a developer-friendly appearance consistent with the existing `TransactionPipeline` component.
4. WHEN a Transaction_Record has a "Failed" status, THE Transaction_History_View SHALL render the status badge with high-contrast red styling and display the failure reason if available.

---

### Requirement 3: Transaction Detail Expansion

**User Story:** As a developer or power user, I want to expand a transaction entry to see its full XDR and simulation diagnostics, so that I can debug and audit the exact on-chain data.

#### Acceptance Criteria

1. WHEN a user activates the expand control on a Transaction_Record row, THE Transaction_History_View SHALL reveal a detail panel containing the full transaction hash, raw XDR (if available), and Simulation_Log metrics (fee breakdown, CPU instructions, memory bytes, ledger read/write bytes).
2. WHEN the detail panel is open and the application is in Dev_Mode, THE Transaction_History_View SHALL render the raw unsigned XDR and signed XDR in collapsible, copyable code blocks using monospace typography.
3. WHEN a user activates the copy control adjacent to a hash or XDR value, THE Transaction_History_View SHALL write the value to the system clipboard and display a transient "Copied!" confirmation for 2 seconds.
4. WHERE the application is NOT in Dev_Mode, THE Transaction_History_View SHALL omit raw XDR panels from the detail view to avoid exposing unnecessary technical data in production.

---

### Requirement 4: Filtering and Search

**User Story:** As a user with many transactions, I want to filter my history by operation type and date range, so that I can quickly locate specific transactions.

#### Acceptance Criteria

1. THE Transaction_History_View SHALL provide a filter control that allows the user to select one or more operation types (Escrow Deposit, Milestone Release, Bid Submit, Dispute Open, Other) to include in the displayed list.
2. THE Transaction_History_View SHALL provide a date-range picker that restricts displayed Transaction_Records to those whose timestamps fall within the selected range.
3. WHEN a filter or date-range selection changes, THE Transaction_History_View SHALL update the displayed Transaction_Record list within 300ms without a full page reload.
4. WHEN all filters are cleared, THE Transaction_History_View SHALL restore the full unfiltered Transaction_Record list.
5. IF no Transaction_Records match the active filters, THEN THE Transaction_History_View SHALL display an empty-state message indicating that no results match the current filter criteria.

---

### Requirement 5: Live Pipeline Integration

**User Story:** As a user who just submitted a transaction, I want the history view to reflect the new transaction immediately after confirmation, so that I do not need to manually refresh.

#### Acceptance Criteria

1. WHEN the `use-tx-status-store` transitions to the "confirmed" step, THE Transaction_History_View SHALL prepend the newly confirmed Transaction_Record to the top of the history list without requiring a page reload.
2. WHEN the `use-tx-status-store` transitions to the "failed" step, THE Transaction_History_View SHALL prepend a failed Transaction_Record entry to the top of the history list with the failure reason.
3. WHILE a transaction is in any non-idle, non-terminal Pipeline step, THE Transaction_History_View SHALL display an in-progress indicator at the top of the history list showing the current Pipeline step label.

---

### Requirement 6: Sequence Number Mismatch Recovery

**User Story:** As a user on a busy network, I want the system to automatically recover from sequence number errors, so that my transactions are not silently dropped.

#### Acceptance Criteria

1. WHEN a transaction submission returns a `tx_bad_seq` error code, THE Pipeline SHALL refresh the source account state from the Soroban_RPC and rebuild the transaction with the updated Sequence_Number.
2. THE Pipeline SHALL retry the Build → Simulate → Sign → Submit sequence up to 3 times following a Sequence_Number mismatch before surfacing a terminal error to the user.
3. WHEN a retry attempt begins, THE Transaction_History_View SHALL display a status message indicating the retry attempt number and the maximum number of retries (e.g. "Sequence mismatch — retrying (1/3)").
4. IF all retry attempts are exhausted, THEN THE Pipeline SHALL emit a terminal "failed" step with a human-readable error message that includes the phrase "sequence number mismatch" and the number of attempts made.

---

### Requirement 7: Fee and Resource Transparency

**User Story:** As a user concerned about transaction costs, I want to see the simulated and actual fees before and after signing, so that I can make informed decisions.

#### Acceptance Criteria

1. WHEN the Pipeline completes the Simulate step, THE Transaction_History_View SHALL display the Simulation_Log including estimated total fee (in XLM), CPU instruction count, memory byte count, and ledger read/write bytes.
2. THE Transaction_History_View SHALL dynamically apply a 2% safety margin to the simulated resource fee when assembling the final transaction, consistent with the `FEE_MARGIN_BPS = 200` constant in `job-registry.ts`.
3. WHEN a Transaction_Record is expanded, THE Transaction_History_View SHALL show both the simulated fee and the actual fee charged on-chain (sourced from the Horizon_Server response) so the user can compare them.
4. THE Transaction_History_View SHALL format all fee values in XLM with 7 decimal places (e.g. "0.0001234 XLM") and include the raw Stroops value as a secondary label.

---

### Requirement 8: Wallet Security and Signature Handling

**User Story:** As a security-conscious user, I want all signing operations to remain within my wallet provider, so that my private key is never exposed to the application.

#### Acceptance Criteria

1. THE Transaction_History_View SHALL delegate all transaction signing exclusively to the Wallet_Provider via the `signTransaction` function in `stellar.ts`, without accepting, storing, or logging private key material.
2. WHEN the Wallet_Provider rejects a signing request (e.g. user cancels), THE Pipeline SHALL transition to the "failed" step with a user-facing message stating that the signing was cancelled, without retrying the sign step.
3. THE Transaction_History_View SHALL never render private key material, seed phrases, or raw secret keys in any UI element, log statement, or clipboard operation.
4. WHERE the application is in Dev_Mode, THE Transaction_History_View SHALL log the signed XDR to the browser console only after the Wallet_Provider has produced it, and SHALL label the log entry with `[soroban-pipeline][signed-xdr]` to distinguish it from unsigned data.

---

### Requirement 9: Accessibility and Responsive Layout

**User Story:** As a user on any device, I want the transaction history to be readable and navigable using keyboard and screen reader, so that the interface is inclusive.

#### Acceptance Criteria

1. THE Transaction_History_View SHALL assign `role="status"` and `aria-live="polite"` to the live pipeline progress indicator so that screen readers announce step changes.
2. THE Transaction_History_View SHALL assign `aria-label` attributes to all icon-only controls (copy button, expand button, Explorer_Link) that describe the action and the associated transaction hash.
3. THE Transaction_History_View SHALL be navigable using keyboard Tab and Enter/Space keys, with visible focus indicators on all interactive elements.
4. THE Transaction_History_View SHALL render a single-column layout on viewports narrower than 640px and a multi-column layout on viewports 640px and wider, using Tailwind CSS responsive prefixes consistent with the existing component library.

---

### Requirement 10: Developer Diagnostics and Logging

**User Story:** As a developer integrating or debugging the platform, I want detailed logs of XDR construction and simulation results in non-production environments, so that I can diagnose failures quickly.

#### Acceptance Criteria

1. WHERE the application is in Dev_Mode, THE Pipeline SHALL log the unsigned XDR to the browser console at the Build step using the label `[soroban-pipeline][build]`.
2. WHERE the application is in Dev_Mode, THE Pipeline SHALL log the full Simulation_Log object to the browser console at the Simulate step using the label `[soroban-pipeline][simulate]`.
3. WHERE the application is in Dev_Mode, THE Pipeline SHALL log the prepared (assembled) XDR to the browser console at the Simulate step using the label `[soroban-pipeline][prepared-xdr]`.
4. THE Pipeline SHALL suppress all diagnostic console output in production builds (`NODE_ENV === "production"`) to avoid leaking transaction structure to end users.
5. WHEN a Simulation_Log is available, THE Transaction_History_View SHALL render the raw simulation response object in a collapsible JSON panel within the detail view, exclusively in Dev_Mode.
