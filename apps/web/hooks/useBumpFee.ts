/**
 * useBumpFee.ts
 *
 * React hook that wraps BumpFeeService, wiring the wallet-kit signing
 * function and exposing reactive state for UI components.
 *
 * Usage:
 *   const { execute, status, result, isLoading } = useBumpFee();
 *
 *   await execute({
 *     contractId: ESCROW_CONTRACT_ID,
 *     functionName: "bump_fee",
 *     args: [jobId, newFeeAmount],
 *     sourcePublicKey: connectedAddress,
 *   });
 */

import { useCallback, useState } from "react";
import { useWalletKit } from "@/hooks/useWalletKit";
import {
  BumpFeeParams,
  BumpFeeResult,
  TxStatus,
  getBumpFeeService,
} from "@/lib/stellar/bumpFeeService";

export function useBumpFee() {
  const { kit, address } = useWalletKit();
  const [status, setStatus] = useState<TxStatus | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [result, setResult] = useState<BumpFeeResult | null>(null);

  const execute = useCallback(
    async (params: BumpFeeParams): Promise<BumpFeeResult> => {
      setResult(null);

      const service = getBumpFeeService();

      /**
       * signTx delegates signing to the connected Freighter wallet via
       * stellar-wallets-kit. Private key never leaves the extension.
       */
      const signTx = async (xdrEnvelope: string): Promise<string> => {
        const { signedTxXdr } = await kit.signTransaction(xdrEnvelope, {
          address,
          networkPassphrase: "Test SDF Network ; September 2015",
        });
        return signedTxXdr;
      };

      const txResult = await service.execute(
        params,
        signTx,
        (newStatus, detail) => {
          setStatus(newStatus);
          setStatusDetail(detail);
        },
      );

      setResult(txResult);
      return txResult;
    },
    [kit, address],
  );

  return {
    execute,
    status,
    statusDetail,
    result,
    isLoading: status !== null && status !== "success" && status !== "error",
    isSuccess: status === "success",
    isError: status === "error",
    reset: () => {
      setStatus(null);
      setStatusDetail(undefined);
      setResult(null);
    },
  };
}
