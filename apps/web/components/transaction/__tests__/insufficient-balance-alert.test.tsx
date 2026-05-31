import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InsufficientBalanceAlert } from "../insufficient-balance-alert";
import { isInsufficientBalanceError } from "@/lib/error-mapper";

describe("InsufficientBalanceAlert (#179)", () => {
  it("renders required, available, and computed shortfall", () => {
    render(<InsufficientBalanceAlert required="100" available="35" />);

    expect(screen.getByTestId("insufficient-balance-alert-required")).toHaveTextContent("100 XLM");
    expect(screen.getByTestId("insufficient-balance-alert-available")).toHaveTextContent("35 XLM");
    expect(screen.getByTestId("insufficient-balance-alert-shortfall")).toHaveTextContent("65 XLM");
  });

  it("renders em-dash for non-numeric balances", () => {
    render(<InsufficientBalanceAlert required="abc" available="35" />);
    expect(screen.getByTestId("insufficient-balance-alert-shortfall")).toHaveTextContent("—");
  });

  it("renders em-dash when shortfall is non-positive", () => {
    render(<InsufficientBalanceAlert required="10" available="20" />);
    expect(screen.getByTestId("insufficient-balance-alert-shortfall")).toHaveTextContent("—");
  });

  it("hides each CTA unless its handler/url is provided", () => {
    render(<InsufficientBalanceAlert required="100" available="0" />);
    expect(screen.queryByTestId("insufficient-balance-alert-fund")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insufficient-balance-alert-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insufficient-balance-alert-explorer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insufficient-balance-alert-dismiss")).not.toBeInTheDocument();
  });

  it("invokes onRetry and onDismiss when their buttons are clicked", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InsufficientBalanceAlert
        required="100"
        available="0"
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("insufficient-balance-alert-retry"));
    fireEvent.click(screen.getByTestId("insufficient-balance-alert-dismiss"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders fund and explorer links with security attributes", () => {
    render(
      <InsufficientBalanceAlert
        required="100"
        available="0"
        fundUrl="https://faucet.example/"
        explorerUrl="https://explorer.example/tx/abc"
      />,
    );
    const fund = screen.getByTestId("insufficient-balance-alert-fund");
    expect(fund).toHaveAttribute("href", "https://faucet.example/");
    expect(fund).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("insufficient-balance-alert-explorer")).toHaveAttribute(
      "href",
      "https://explorer.example/tx/abc",
    );
  });

  it("uses a custom asset symbol", () => {
    render(<InsufficientBalanceAlert required="50" available="10" asset="USDC" />);
    expect(screen.getByText(/Insufficient USDC balance/)).toBeInTheDocument();
    expect(screen.getByTestId("insufficient-balance-alert-required")).toHaveTextContent("50 USDC");
  });
});

describe("isInsufficientBalanceError (#179 detection)", () => {
  it("matches Horizon transaction codes", () => {
    expect(isInsufficientBalanceError(new Error("tx_insufficient_balance"))).toBe(true);
  });

  it("matches Soroban operation codes", () => {
    expect(isInsufficientBalanceError(new Error("op_underfunded"))).toBe(true);
  });

  it("matches free-text simulation messages", () => {
    expect(isInsufficientBalanceError("Simulation: insufficient funds for fee")).toBe(true);
    expect(isInsufficientBalanceError("balance below minimum")).toBe(true);
  });

  it("matches structured Horizon error responses", () => {
    expect(
      isInsufficientBalanceError({
        response: {
          data: {
            extras: {
              result_codes: { transaction: "tx_insufficient_balance" },
            },
          },
        },
      }),
    ).toBe(true);
    expect(
      isInsufficientBalanceError({
        response: {
          data: {
            extras: {
              result_codes: { operations: ["op_underfunded"] },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isInsufficientBalanceError(new Error("tx_bad_seq"))).toBe(false);
    expect(isInsufficientBalanceError("network timeout")).toBe(false);
    expect(isInsufficientBalanceError(undefined)).toBe(false);
  });
});
