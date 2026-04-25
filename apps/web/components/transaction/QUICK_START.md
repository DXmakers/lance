# Transaction Status Modal - Quick Start

Get up and running in 5 minutes.

## Installation

No additional dependencies needed! The component uses existing packages:
- React 19
- Zustand (already installed)
- Lucide React (already installed)
- Tailwind CSS (already configured)

## Step 1: Import the Component

```tsx
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
```

## Step 2: Add to Your Component

```tsx
function MyComponent() {
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal();

  return (
    <>
      {/* Your UI */}
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## Step 3: Trigger on Transaction

```tsx
const handleTransaction = async () => {
  resetAndOpen(); // Opens modal and clears previous state
  
  try {
    await postJob(params, (step, detail, metadata) => {
      // Updates are handled automatically by the store
    });
  } catch (error) {
    // Error state is shown automatically
  }
};
```

## Complete Example

```tsx
"use client";

import { useState } from "react";
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTransactionModal } from "@/hooks/use-transaction-modal";
import { usePostJob } from "@/hooks/use-post-job";

export function PostJobButton() {
  const { submit, isSubmitting } = usePostJob();
  const { isModalOpen, resetAndOpen, closeModal } = useTransactionModal();

  const handleClick = async () => {
    resetAndOpen();
    
    await submit({
      title: "My Job",
      description: "Job description",
      budgetUsdc: 100,
      milestones: 3,
    });
  };

  return (
    <>
      <button 
        onClick={handleClick} 
        disabled={isSubmitting}
        className="btn-primary"
      >
        Post Job
      </button>

      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
}
```

## That's It!

The modal will automatically:
- ✅ Show progress through all 5 steps
- ✅ Display simulation diagnostics
- ✅ Provide copy-to-clipboard for hashes
- ✅ Link to block explorer on success
- ✅ Show detailed errors on failure
- ✅ Handle polling with exponential backoff

## Next Steps

- **Customize**: See [USAGE_GUIDE.md](./USAGE_GUIDE.md) for advanced options
- **Integrate**: Check [INTEGRATION_EXAMPLES.md](./INTEGRATION_EXAMPLES.md) for patterns
- **Test**: Run `npm test -- transaction-status-modal.test.tsx`
- **Demo**: Visit `/demo/transaction-modal` to see it in action

## Common Patterns

### Auto-Open on Transaction Start

```tsx
const { isModalOpen, closeModal } = useTransactionModalWithAutoOpen();
```

### Auto-Close After Success

```tsx
const { isModalOpen, closeModal } = useTransactionModalWithAutoClose({
  autoCloseDelay: 5000, // 5 seconds
});
```

### Success/Error Callbacks

```tsx
const { isModalOpen, closeModal } = useTransactionModal({
  onSuccess: (txHash) => {
    console.log("Success:", txHash);
    router.push(`/jobs/${jobId}`);
  },
  onError: (error) => {
    console.error("Failed:", error);
    toast.error(error);
  },
});
```

## Troubleshooting

**Modal doesn't appear?**
- Check `isOpen={true}` and transaction has started

**Polling never completes?**
- Verify RPC URL is correct in `.env`

**Copy button doesn't work?**
- Requires HTTPS in production

Need help? Check the full documentation in [README.md](./README.md)
