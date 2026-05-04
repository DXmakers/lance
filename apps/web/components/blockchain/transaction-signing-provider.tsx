"use client";

import { useWallet } from "@/hooks/use-wallet";
import { SignTransactionModal } from "@/components/blockchain/sign-transaction-modal";

export function TransactionSigningProvider({ children }: { children: React.ReactNode }) {
  const { signingTx, confirmSigning, cancelSigning } = useWallet();

  return (
    <>
      {children}
      <SignTransactionModal 
        xdr={signingTx} 
        onConfirm={confirmSigning} 
        onCancel={cancelSigning} 
      />
    </>
  );
}
