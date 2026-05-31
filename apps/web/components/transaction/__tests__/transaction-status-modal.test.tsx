/**
 * Test suite for TransactionStatusModal
 * 
 * Tests:
 *  - State machine logic (step transitions)
 *  - UI rendering for each lifecycle step
 *  - Copy-to-clipboard functionality
 *  - Advanced details expand/collapse
 *  - Error handling and retry actions
 *  - Polling behavior
 *  - Ghost state (indexing)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TransactionStatusModal } from "../transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import type { TxLifecycleStep } from "@/lib/job-registry";

// Mock the store
vi.mock("@/lib/store/use-tx-status-store");

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(() => Promise.resolve()),
  },
});

describe("TransactionStatusModal", () => {
  const mockOnClose = vi.fn();

  const defaultStoreState = {
    step: "idle" as TxLifecycleStep,
    detail: null,
    txHash: null,
    rawXdr: null,
    simulation: null,
    startedAt: null,
    finishedAt: null,
    setStep: vi.fn(),
    setTxHash: vi.fn(),
    setRawXdr: vi.fn(),
    setSimulation: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      defaultStoreState
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ─── Rendering Tests ────────────────────────────────────────────────────

  it("should not render when closed", () => {
    const { container } = render(
      <TransactionStatusModal isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should not render when step is idle", () => {
    const { container } = render(
      <TransactionStatusModal isOpen={true} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render modal when open and step is active", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "building",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Transaction Status")).toBeInTheDocument();
    expect(screen.getByText("Processing blockchain transaction...")).toBeInTheDocument();
  });

  // ─── Step Progression Tests ─────────────────────────────────────────────

  it("should display all 5 steps in progress tracker", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "building",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Simulate")).toBeInTheDocument();
    expect(screen.getByText("Sign")).toBeInTheDocument();
    expect(screen.getByText("Submit")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("should highlight active step during building", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "building",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Building transaction with your parameters...")).toBeInTheDocument();
  });

  it("should show simulation message during simulating step", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "simulating",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Simulating transaction on Soroban network...")).toBeInTheDocument();
  });

  it("should show wallet prompt during signing step", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "signing",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Please sign the transaction in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Check your wallet for a signature request")).toBeInTheDocument();
  });

  it("should show submitting message during submit step", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "submitting",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Broadcasting transaction to the network...")).toBeInTheDocument();
  });

  it("should show confirming message during confirm step", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirming",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Waiting for ledger confirmation...")).toBeInTheDocument();
  });

  // ─── Success State Tests ────────────────────────────────────────────────

  it("should display success state when confirmed", () => {
    const mockTxHash = "abc123def456";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: mockTxHash,
      startedAt: Date.now() - 5000,
      finishedAt: Date.now(),
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Transaction Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Your transaction has been successfully included in the ledger.")).toBeInTheDocument();
    expect(screen.getByText(mockTxHash)).toBeInTheDocument();
  });

  it("should display elapsed time on success", () => {
    const startTime = Date.now() - 3500;
    const endTime = Date.now();
    
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: "test-hash",
      startedAt: startTime,
      finishedAt: endTime,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    // Should show elapsed time in seconds
    const elapsedText = screen.getByText(/\d+\.\d{2}s/);
    expect(elapsedText).toBeInTheDocument();
  });

  it("should show indexing ghost state after confirmation", async () => {
    vi.useFakeTimers();
    
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: "test-hash",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    // Should show indexing message
    expect(screen.getByText(/Indexing\.\.\./)).toBeInTheDocument();
    
    // After 3 seconds, indexing message should disappear
    vi.advanceTimersByTime(3000);
    await waitFor(() => {
      expect(screen.queryByText(/Indexing\.\.\./)).not.toBeInTheDocument();
    });
    
    vi.useRealTimers();
  });

  // ─── Error State Tests ──────────────────────────────────────────────────

  it("should display error state when failed", () => {
    const errorMessage = "Simulation failed: insufficient balance";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "failed",
      detail: errorMessage,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Transaction Failed")).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it("should show retry buttons when failed during build/simulate", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "failed",
      detail: "Simulation error",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Edit Parameters")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  // ─── Simulation Diagnostics Tests ──────────────────────────────────────

  it("should display simulation results when available", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "simulating",
      simulation: {
        fee: "1000000",
        cpuInstructions: "500000",
        memoryBytes: "2048",
      },
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText("Simulation Results")).toBeInTheDocument();
    expect(screen.getByText("0.1000000 XLM")).toBeInTheDocument(); // Fee conversion
    expect(screen.getByText("500000")).toBeInTheDocument(); // CPU
    expect(screen.getByText("2048")).toBeInTheDocument(); // Memory
  });

  // ─── Advanced Details Tests ─────────────────────────────────────────────

  it("should toggle advanced details section", async () => {
    const mockXdr = "AAAAAAAAAAAAAAAABBBBBBBBBBBBBBBB";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "signing",
      rawXdr: mockXdr,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const advancedButton = screen.getByText("Advanced Transaction Details");
    expect(advancedButton).toBeInTheDocument();
    
    // Should not show XDR initially
    expect(screen.queryByText(mockXdr)).not.toBeInTheDocument();
    
    // Click to expand
    fireEvent.click(advancedButton);
    
    // Should show XDR
    await waitFor(() => {
      expect(screen.getByText(mockXdr)).toBeInTheDocument();
    });
    
    // Click to collapse
    fireEvent.click(advancedButton);
    
    // Should hide XDR
    await waitFor(() => {
      expect(screen.queryByText(mockXdr)).not.toBeInTheDocument();
    });
  });

  it("should display security warning in advanced details", async () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "signing",
      rawXdr: "TEST_XDR",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    // Expand advanced details
    fireEvent.click(screen.getByText("Advanced Transaction Details"));
    
    await waitFor(() => {
      expect(screen.getByText(/Never share XDRs containing sensitive operations/)).toBeInTheDocument();
    });
  });

  // ─── Copy Functionality Tests ───────────────────────────────────────────

  it("should copy transaction hash to clipboard", async () => {
    const mockTxHash = "test-tx-hash-123";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: mockTxHash,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const copyButton = screen.getAllByLabelText("Copy transaction hash")[0];
    fireEvent.click(copyButton);
    
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockTxHash);
    });
  });

  it("should copy XDR to clipboard", async () => {
    const mockXdr = "TEST_XDR_STRING";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "signing",
      rawXdr: mockXdr,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    // Expand advanced details
    fireEvent.click(screen.getByText("Advanced Transaction Details"));
    
    await waitFor(() => {
      const copyButton = screen.getByLabelText("Copy XDR");
      fireEvent.click(copyButton);
    });
    
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockXdr);
    });
  });

  // ─── Close Behavior Tests ───────────────────────────────────────────────

  it("should prevent closing during active transaction", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "submitting",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const closeButton = screen.getByLabelText("Close modal");
    fireEvent.click(closeButton);
    
    // Should not call onClose during active transaction
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("should allow closing when transaction is confirmed", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: "test-hash",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const closeButton = screen.getByText("Close");
    fireEvent.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should allow closing when transaction failed", () => {
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "failed",
      detail: "Error message",
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const closeButton = screen.getByText("Close");
    fireEvent.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // ─── Explorer Link Tests ────────────────────────────────────────────────

  it("should render block explorer link with correct URL", () => {
    const mockTxHash = "explorer-test-hash";
    (useTxStatusStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      step: "confirmed",
      txHash: mockTxHash,
    });

    render(<TransactionStatusModal isOpen={true} onClose={mockOnClose} />);
    
    const explorerLink = screen.getByLabelText("View on block explorer");
    expect(explorerLink).toHaveAttribute(
      "href",
      expect.stringContaining(mockTxHash)
    );
    expect(explorerLink).toHaveAttribute("target", "_blank");
    expect(explorerLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
