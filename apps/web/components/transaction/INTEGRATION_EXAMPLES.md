# Integration Examples

Real-world examples of integrating the TransactionStatusModal with your application.

## Example 1: Post Job with Modal

Replace the existing toast-only approach with the modal for better UX.

### Before (Toast Only)

```tsx
import { usePostJob } from "@/hooks/use-post-job";

function PostJobForm() {
  const { submit, isSubmitting } = usePostJob();

  const handleSubmit = async (data: PostJobInput) => {
    await submit(data);
    // User only sees toast notifications
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <button type="submit" disabled={isSubmitting}>
        Post Job
      </button>
    </form>
  );
}
```

### After (Modal + Toast)

```tsx
import { usePostJob } from "@/hooks/use-post-job";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";

function PostJobForm() {
  const { submit, isSubmitting } = usePostJob();
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal({
    onSuccess: (txHash) => {
      console.log("Job posted successfully:", txHash);
    },
    onError: (error) => {
      console.error("Job posting failed:", error);
    },
  });

  const handleSubmit = async (data: PostJobInput) => {
    resetAndOpen(); // Open modal and reset previous state
    await submit(data);
    // Modal shows detailed progress, toasts provide quick feedback
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        {/* Form fields */}
        <button type="submit" disabled={isSubmitting}>
          Post Job
        </button>
      </form>

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## Example 2: Submit Bid with Auto-Open

Automatically open the modal when the transaction starts.

```tsx
import { useSubmitBid } from "@/hooks/use-submit-bid";
import { useTransactionModalWithAutoOpen } from "@/hooks/use-transaction-modal";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";

function SubmitBidButton({ jobId }: { jobId: number }) {
  const { submit, isSubmitting } = useSubmitBid();
  const { isModalOpen, closeModal } = useTransactionModalWithAutoOpen({
    autoCloseOnSuccess: true,
    autoCloseDelay: 5000, // Auto-close after 5 seconds
  });

  const handleSubmit = async () => {
    await submit({
      jobId: BigInt(jobId),
      proposalHash: "QmYourProposalHash",
    });
  };

  return (
    <>
      <button 
        onClick={handleSubmit} 
        disabled={isSubmitting}
        className="btn-primary"
      >
        Submit Bid
      </button>

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## Example 3: Job Detail Page with Inline Tracker

Show the transaction tracker inline on the page, plus a detailed modal.

```tsx
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTransactionModal, useTransactionStep } from "@/hooks/use-transaction-modal";

function JobDetailPage({ jobId }: { jobId: number }) {
  const { isModalOpen, openModal, closeModal } = useTransactionModal();
  const { isActive } = useTransactionStep();

  return (
    <div>
      <h1>Job #{jobId}</h1>

      {/* Inline tracker - always visible when transaction is active */}
      {isActive && (
        <div className="mb-6">
          <TransactionTracker />
          <button 
            onClick={openModal}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            View Details
          </button>
        </div>
      )}

      {/* Job details */}
      <div className="job-content">
        {/* ... */}
      </div>

      {/* Detailed modal - opened on demand */}
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </div>
  );
}
```

## Example 4: Multi-Step Form with Transaction

Guide users through a multi-step form, then show the transaction modal.

```tsx
import { useState } from "react";
import { usePostJob } from "@/hooks/use-post-job";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";

function MultiStepJobForm() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({});
  
  const { submit } = usePostJob();
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal({
    onSuccess: () => {
      // Reset form after successful transaction
      setStep(1);
      setFormData({});
    },
  });

  const handleFinalSubmit = async () => {
    resetAndOpen();
    await submit(formData);
  };

  return (
    <div>
      {step === 1 && (
        <Step1Form 
          data={formData} 
          onNext={(data) => {
            setFormData({ ...formData, ...data });
            setStep(2);
          }} 
        />
      )}

      {step === 2 && (
        <Step2Form 
          data={formData} 
          onNext={(data) => {
            setFormData({ ...formData, ...data });
            setStep(3);
          }}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Step3Review 
          data={formData}
          onSubmit={handleFinalSubmit}
          onBack={() => setStep(2)}
        />
      )}

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </div>
  );
}
```

## Example 5: Dashboard with Transaction History

Show recent transactions with the ability to view details.

```tsx
import { useState } from "react";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";

interface Transaction {
  id: string;
  type: string;
  status: string;
  txHash?: string;
  timestamp: number;
}

function TransactionHistory({ transactions }: { transactions: Transaction[] }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, reset } = useTxStatusStore();

  const viewTransaction = (tx: Transaction) => {
    reset();
    
    // Reconstruct transaction state for viewing
    if (tx.status === "confirmed" && tx.txHash) {
      setStep("confirmed");
      setTxHash(tx.txHash);
    } else if (tx.status === "failed") {
      setStep("failed", "Transaction failed");
    }
    
    setIsModalOpen(true);
  };

  return (
    <div>
      <h2>Recent Transactions</h2>
      <div className="space-y-2">
        {transactions.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between p-4 border rounded">
            <div>
              <p className="font-medium">{tx.type}</p>
              <p className="text-sm text-gray-500">
                {new Date(tx.timestamp).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => viewTransaction(tx)}
              className="text-blue-600 hover:underline"
            >
              View Details
            </button>
          </div>
        ))}
      </div>

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
}
```

## Example 6: Wallet Connection with Transaction

Ensure wallet is connected before showing the modal.

```tsx
import { useWallet } from "@/hooks/use-wallet";
import { usePostJob } from "@/hooks/use-post-job";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";

function PostJobWithWallet() {
  const { isConnected, connect, address } = useWallet();
  const { submit } = usePostJob();
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal();

  const handleSubmit = async (data: PostJobInput) => {
    // Ensure wallet is connected
    if (!isConnected) {
      await connect();
    }

    // Proceed with transaction
    resetAndOpen();
    await submit(data);
  };

  return (
    <>
      <div>
        {!isConnected ? (
          <button onClick={connect} className="btn-primary">
            Connect Wallet
          </button>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Connected: {address?.slice(0, 8)}...{address?.slice(-6)}
            </p>
            <button onClick={() => handleSubmit(formData)} className="btn-primary">
              Post Job
            </button>
          </div>
        )}
      </div>

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## Example 7: Progress Indicator in Button

Show transaction progress in the submit button.

```tsx
import { useTransactionProgress, useTransactionStep } from "@/hooks/use-transaction-modal";
import { Loader2 } from "lucide-react";

function SubmitButtonWithProgress({ onClick }: { onClick: () => void }) {
  const { progress, isComplete } = useTransactionProgress();
  const { step, isActive } = useTransactionStep();

  const getButtonText = () => {
    if (isComplete) return "Transaction Complete";
    if (isActive) {
      switch (step) {
        case "building": return "Building...";
        case "simulating": return "Simulating...";
        case "signing": return "Waiting for Signature...";
        case "submitting": return "Submitting...";
        case "confirming": return "Confirming...";
        default: return "Processing...";
      }
    }
    return "Submit Transaction";
  };

  return (
    <button
      onClick={onClick}
      disabled={isActive}
      className="relative btn-primary overflow-hidden"
    >
      {/* Progress bar background */}
      {isActive && (
        <div
          className="absolute inset-0 bg-blue-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      )}

      {/* Button content */}
      <span className="relative flex items-center gap-2">
        {isActive && <Loader2 className="h-4 w-4 animate-spin" />}
        {getButtonText()}
      </span>
    </button>
  );
}
```

## Example 8: Error Recovery Flow

Handle errors gracefully with retry logic.

```tsx
import { useState } from "react";
import { usePostJob } from "@/hooks/use-post-job";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";

function PostJobWithRetry() {
  const [lastFormData, setLastFormData] = useState<PostJobInput | null>(null);
  const { submit } = usePostJob();
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal({
    onError: (error) => {
      console.error("Transaction failed:", error);
      // Keep form data for retry
    },
  });

  const handleSubmit = async (data: PostJobInput) => {
    setLastFormData(data);
    resetAndOpen();
    
    try {
      await submit(data);
    } catch (error) {
      // Error is handled by modal and onError callback
    }
  };

  const handleRetry = () => {
    if (lastFormData) {
      handleSubmit(lastFormData);
    }
  };

  return (
    <>
      <form onSubmit={(e) => {
        e.preventDefault();
        handleSubmit(formData);
      }}>
        {/* Form fields */}
        <button type="submit">Submit</button>
      </form>

      {/* Show retry button if last transaction failed */}
      {lastFormData && (
        <button 
          onClick={handleRetry}
          className="mt-2 text-sm text-blue-600 hover:underline"
        >
          Retry Last Transaction
        </button>
      )}

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## Example 9: Notification Center Integration

Combine modal with a notification center for transaction updates.

```tsx
import { useEffect } from "react";
import { useTransactionStep } from "@/hooks/use-transaction-modal";
import { useNotifications } from "@/hooks/use-notifications";

function TransactionNotifications() {
  const { step, detail, isActive } = useTransactionStep();
  const { addNotification } = useNotifications();

  useEffect(() => {
    if (step === "confirmed") {
      addNotification({
        type: "success",
        title: "Transaction Confirmed",
        message: detail || "Your transaction was successful",
      });
    } else if (step === "failed") {
      addNotification({
        type: "error",
        title: "Transaction Failed",
        message: detail || "Your transaction failed",
      });
    }
  }, [step, detail, addNotification]);

  return null; // This is a side-effect only component
}

// Use in your app layout
function AppLayout({ children }) {
  return (
    <div>
      <TransactionNotifications />
      {children}
    </div>
  );
}
```

## Example 10: Analytics Integration

Track transaction events for analytics.

```tsx
import { useEffect } from "react";
import { useTransactionStep } from "@/hooks/use-transaction-modal";
import { analytics } from "@/lib/analytics";

function TransactionAnalytics() {
  const { step, detail } = useTransactionStep();

  useEffect(() => {
    switch (step) {
      case "building":
        analytics.track("transaction_started");
        break;
      case "signing":
        analytics.track("transaction_signing");
        break;
      case "confirmed":
        analytics.track("transaction_confirmed", { txHash: detail });
        break;
      case "failed":
        analytics.track("transaction_failed", { error: detail });
        break;
    }
  }, [step, detail]);

  return null;
}

// Use in your app
function App() {
  return (
    <>
      <TransactionAnalytics />
      {/* Your app content */}
    </>
  );
}
```

## Best Practices

1. **Always reset state** before starting a new transaction
   ```tsx
   const { resetAndOpen } = useTransactionModal();
   resetAndOpen(); // Clears previous state and opens modal
   ```

2. **Handle wallet connection** before transactions
   ```tsx
   if (!isConnected) {
     await connect();
   }
   ```

3. **Provide user feedback** at every step
   ```tsx
   const { onSuccess, onError } = useTransactionModal({
     onSuccess: (txHash) => toast.success(`Transaction ${txHash} confirmed`),
     onError: (error) => toast.error(`Transaction failed: ${error}`),
   });
   ```

4. **Keep form data** for retry scenarios
   ```tsx
   const [lastFormData, setLastFormData] = useState(null);
   ```

5. **Use auto-close** for better UX in non-critical flows
   ```tsx
   const { isModalOpen } = useTransactionModalWithAutoClose({
     autoCloseDelay: 3000,
   });
   ```

6. **Combine with inline tracker** for complex pages
   ```tsx
   {isActive && <TransactionTracker />}
   <button onClick={openModal}>View Details</button>
   ```

7. **Track analytics** for transaction events
   ```tsx
   useEffect(() => {
     if (step === "confirmed") {
       analytics.track("transaction_confirmed");
     }
   }, [step]);
   ```

8. **Test error scenarios** thoroughly
   ```tsx
   // Test: insufficient balance
   // Test: user rejection
   // Test: network timeout
   // Test: sequence mismatch
   ```

9. **Provide context** in error messages
   ```tsx
   setStep("failed", "Insufficient balance: need 0.1 XLM, have 0.05 XLM");
   ```

10. **Use TypeScript** for type safety
    ```tsx
    const handleSubmit = async (data: PostJobInput): Promise<void> => {
      // Type-safe implementation
    };
    ```
