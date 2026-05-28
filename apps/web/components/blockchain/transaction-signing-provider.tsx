"use client";

import { useWalletStore } from "@/lib/store/use-wallet-store";
import { SignTransactionModal } from "@/components/blockchain/sign-transaction-modal";

export function TransactionSigningProvider({ children }: { children: React.ReactNode }) {
  const { signingTx, setSigningTx } = useWalletStore();
  const confirmSigning = () => setSigningTx(null);
  const cancelSigning = () => setSigningTx(null);


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
