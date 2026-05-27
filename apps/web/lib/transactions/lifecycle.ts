/**
 * lifecycle.ts
 *
 * Complete transaction lifecycle orchestration with immediate UI state updates.
 * Manages transaction states, emits events, and triggers UI updates.
 */

import { Transaction } from "@stellar/stellar-sdk";
import { SubmissionResult } from "./submitter";
import { PollingResult } from "./poller";
import { SimulationResult } from "./simulator";
import { FeeEstimate } from "./fee-estimator";

export type TransactionState =
  | "IDLE"
  | "BUILDING"
  | "SIMULATING"
  | "SIGNING"
  | "SUBMITTING"
  | "CONFIRMING"
  | "SUCCESS"
  | "FAILED";

export interface TransactionMetadata {
  /** Unique transaction ID for tracking */
  id: string;
  /** Current state of the transaction */
  state: TransactionState;
  /** Transaction hash (available after submission) */
  txHash?: string;
  /** Source account address */
  sourceAddress: string;
  /** Contract ID being invoked */
  contractId?: string;
  /** Contract method being called */
  method?: string;
  /** Timestamp of transaction creation */
  createdAt: Date;
  /** Timestamp of last state change */
  updatedAt: Date;
  /** Timestamp of completion (success or failure) */
  completedAt?: Date;
}

export interface TransactionEvent {
  /** Event type corresponding to state transition */
  type: TransactionState;
  /** Transaction metadata */
  metadata: TransactionMetadata;
  /** Raw transaction object */
  transaction?: Transaction;
  /** Simulation result (available after SIMULATING) */
  simulation?: SimulationResult;
  /** Fee estimate (available after SIMULATING) */
  feeEstimate?: FeeEstimate;
  /** Signed XDR (available after SIGNING) */
  signedXdr?: string;
  /** Submission result (available after SUBMITTING) */
  submission?: SubmissionResult;
  /** Polling result (available after CONFIRMING) */
  polling?: PollingResult;
  /** Error message (available on FAILED) */
  error?: string;
  /** Error code for categorization */
  errorCode?: string;
  /** Raw data for dev logging */
  devData?: {
    unsignedXdr?: string;
    simulationResponse?: unknown;
    submissionResponse?: unknown;
  };
}

export type TransactionEventListener = (event: TransactionEvent) => void;

/**
 * Transaction lifecycle manager.
 * Orchestrates the complete transaction flow and emits events for UI updates.
 */
export class TransactionLifecycleManager {
  private metadata: TransactionMetadata;
  private listeners: Set<TransactionEventListener> = new Set();
  private history: TransactionEvent[] = [];

  constructor(sourceAddress: string, contractId?: string, method?: string) {
    this.metadata = {
      id: this.generateTransactionId(),
      state: "IDLE",
      sourceAddress,
      contractId,
      method,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Generates a unique transaction ID.
   */
  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Subscribes to transaction events.
   *
   * @param listener - Callback function for events
   * @returns Unsubscribe function
   */
  public subscribe(listener: TransactionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emits a transaction event to all listeners.
   */
  private emitEvent(event: TransactionEvent): void {
    this.history.push(event);

    if (process.env.NODE_ENV === "development") {
      console.log(`[lifecycle] Event: ${event.type}`, {
        txId: this.metadata.id,
        txHash: this.metadata.txHash,
        error: event.error,
        devData: event.devData,
      });
    }

    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("[lifecycle] Error in event listener:", error);
      }
    });
  }

  /**
   * Transitions to BUILDING state.
   */
  public transitionToBuilding(tx: Transaction, unsignedXdr?: string): void {
    this.updateState("BUILDING");
    this.emitEvent({
      type: "BUILDING",
      metadata: this.metadata,
      transaction: tx,
      devData: { unsignedXdr },
    });
  }

  /**
   * Transitions to SIMULATING state.
   */
  public transitionToSimulating(): void {
    this.updateState("SIMULATING");
    this.emitEvent({
      type: "SIMULATING",
      metadata: this.metadata,
    });
  }

  /**
   * Transitions to SIMULATING complete with results.
   */
  public transitionSimulationComplete(
    simulation: SimulationResult,
    feeEstimate: FeeEstimate,
    simulationResponse?: unknown,
  ): void {
    this.emitEvent({
      type: "SIMULATING",
      metadata: this.metadata,
      simulation,
      feeEstimate,
      devData: { simulationResponse },
    });
  }

  /**
   * Transitions to SIGNING state.
   */
  public transitionToSigning(): void {
    this.updateState("SIGNING");
    this.emitEvent({
      type: "SIGNING",
      metadata: this.metadata,
    });
  }

  /**
   * Transitions to SIGNING complete with signed XDR.
   */
  public transitionSigningComplete(signedXdr: string): void {
    this.emitEvent({
      type: "SIGNING",
      metadata: this.metadata,
      signedXdr,
    });
  }

  /**
   * Transitions to SUBMITTING state.
   */
  public transitionToSubmitting(): void {
    this.updateState("SUBMITTING");
    this.emitEvent({
      type: "SUBMITTING",
      metadata: this.metadata,
    });
  }

  /**
   * Transitions to SUBMITTING complete with submission result.
   */
  public transitionSubmissionComplete(
    submission: SubmissionResult,
    submissionResponse?: unknown,
  ): void {
    this.metadata.txHash = submission.hash;
    this.emitEvent({
      type: "SUBMITTING",
      metadata: this.metadata,
      submission,
      devData: { submissionResponse },
    });
  }

  /**
   * Transitions to CONFIRMING state.
   */
  public transitionToConfirming(txHash: string): void {
    this.metadata.txHash = txHash;
    this.updateState("CONFIRMING");
    this.emitEvent({
      type: "CONFIRMING",
      metadata: this.metadata,
    });
  }

  /**
   * Transitions to SUCCESS state.
   */
  public transitionToSuccess(
    polling: PollingResult,
    txHash: string,
  ): void {
    this.metadata.txHash = txHash;
    this.metadata.state = "SUCCESS";
    this.metadata.completedAt = new Date();
    this.metadata.updatedAt = new Date();

    this.emitEvent({
      type: "SUCCESS",
      metadata: this.metadata,
      polling,
    });
  }

  /**
   * Transitions to FAILED state.
   */
  public transitionToFailed(
    error: string,
    errorCode?: string,
    polling?: PollingResult,
  ): void {
    this.metadata.state = "FAILED";
    this.metadata.completedAt = new Date();
    this.metadata.updatedAt = new Date();

    this.emitEvent({
      type: "FAILED",
      metadata: this.metadata,
      error,
      errorCode,
      polling,
    });
  }

  /**
   * Gets the current transaction metadata.
   */
  public getMetadata(): TransactionMetadata {
    return { ...this.metadata };
  }

  /**
   * Gets the transaction ID.
   */
  public getId(): string {
    return this.metadata.id;
  }

  /**
   * Gets the current state.
   */
  public getState(): TransactionState {
    return this.metadata.state;
  }

  /**
   * Gets the transaction hash (if available).
   */
  public getTxHash(): string | undefined {
    return this.metadata.txHash;
  }

  /**
   * Gets the event history.
   */
  public getHistory(): TransactionEvent[] {
    return [...this.history];
  }

  /**
   * Updates the state and timestamp.
   */
  private updateState(state: TransactionState): void {
    this.metadata.state = state;
    this.metadata.updatedAt = new Date();
  }
}

/**
 * Global event bus for transaction lifecycle events.
 * Allows components to listen to all transactions.
 */
class TransactionEventBus {
  private listeners: Set<TransactionEventListener> = new Set();

  public subscribe(listener: TransactionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(event: TransactionEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("[event-bus] Error in listener:", error);
      }
    });
  }

  public getListenerCount(): number {
    return this.listeners.size;
  }
}

export const transactionEventBus = new TransactionEventBus();

/**
 * Creates a new transaction lifecycle manager.
 *
 * @param sourceAddress - Source account address
 * @param contractId - Optional contract ID
 * @param method - Optional contract method
 * @returns New lifecycle manager instance
 */
export function createTransactionLifecycle(
  sourceAddress: string,
  contractId?: string,
  method?: string,
): TransactionLifecycleManager {
  return new TransactionLifecycleManager(sourceAddress, contractId, method);
}
