# Transaction Status Components

Professional blockchain transaction lifecycle interface for Stellar/Soroban transactions.

## Components

### TransactionStatusModal

A comprehensive modal that provides deep transparency into the blockchain transaction lifecycle with real-time status updates, technical details, and user-friendly feedback.

#### Features

- **5-Step Visual Progress Tracker**: Build → Simulate → Sign → Submit → Confirm
- **Real-time Polling**: Exponential backoff strategy to efficiently monitor transaction status
- **Pulsing Animations**: Smooth "breathing" effect on active steps for clear visual feedback
- **Advanced Technical Details**: Expandable section for raw XDR and simulation diagnostics
- **Click-to-Copy**: One-click copying of transaction hashes and XDR data
- **High-Contrast States**: Clear success (green) and error (red) messaging
- **Block Explorer Integration**: Direct links to Stellar Expert for confirmed transactions
- **Ghost State**: Indexing indicator for post-confirmation delays
- **Security-First**: No private key or sensitive data exposure
- **Monospace Typography**: Developer-friendly display of technical data

#### Usage

```tsx
import { TransactionStatusModal } from "@/components/transaction/transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";

function MyComponent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, setRawXdr, setSimulation } = useTxStatusStore();

  const handleTransaction = async () => {
    setIsModalOpen(true);
    
    try {
      // Your transaction logic with lifecycle callbacks
      await postJob(params, (step, detail, metadata) => {
        setStep(step, detail);
        if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);
      });
    } catch (error) {
      setStep("failed", error.message);
    }
  };

  return (
    <>
      <button onClick={handleTransaction}>Submit Transaction</button>
      <TransactionStatusModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  );
}
```

#### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | `boolean` | Yes | Controls modal visibility |
| `onClose` | `() => void` | Yes | Callback when user closes modal (disabled during active transactions) |

#### State Management

The component reads from `useTxStatusStore` which tracks:

- `step`: Current lifecycle step (idle, building, simulating, signing, submitting, confirming, confirmed, failed)
- `detail`: Human-readable status message or error details
- `txHash`: On-chain transaction hash (available after submission)
- `rawXdr`: Base64-encoded transaction XDR
- `simulation`: Simulation diagnostics (fee, CPU instructions, memory bytes)
- `startedAt`: Transaction start timestamp
- `finishedAt`: Transaction completion timestamp

### TransactionTracker

A standalone visual progress indicator that can be embedded anywhere in your UI.

#### Usage

```tsx
import { TransactionTracker } from "@/components/transaction/transaction-tracker";

function MyPage() {
  return (
    <div>
      <h1>Transaction in Progress</h1>
      <TransactionTracker />
    </div>
  );
}
```

## Lifecycle Steps

### 1. Build
Constructs the transaction with operations and parameters. The XDR is generated at this stage.

**What happens**: Transaction builder creates the operation structure with your parameters.

**User sees**: "Building transaction with your parameters..."

### 2. Simulate
Tests the transaction on the network to estimate fees and resource consumption.

**What happens**: RPC node simulates execution without committing to the ledger.

**User sees**: "Simulating transaction on Soroban network..." + simulation diagnostics

**Common errors**:
- Insufficient balance
- Authorization failures
- Contract execution errors

### 3. Sign
Requests wallet signature for transaction authorization.

**What happens**: Wallet extension/app prompts user to review and sign.

**User sees**: "Please sign the transaction in your wallet" + wallet prompt reminder

**Common errors**:
- User rejection
- Wallet timeout
- Network mismatch

### 4. Submit
Broadcasts the signed transaction to the network.

**What happens**: Transaction is sent to Stellar validators for inclusion.

**User sees**: "Broadcasting transaction to the network..."

**Common errors**:
- Network connectivity issues
- Sequence number mismatch (auto-retried)

### 5. Confirm
Waits for ledger inclusion and finality.

**What happens**: Polls RPC node until transaction appears in a confirmed ledger.

**User sees**: "Waiting for ledger confirmation..." + polling with exponential backoff

**Ghost State**: After confirmation, shows "Indexing..." for 3 seconds to account for explorer delays.

## Polling Strategy

The component implements exponential backoff for efficient network polling:

- **Initial interval**: 2 seconds
- **Max interval**: 10 seconds
- **Backoff multiplier**: 1.5x
- **Strategy**: Reduces RPC load while maintaining responsiveness

```
Poll 1: 2s
Poll 2: 3s
Poll 3: 4.5s
Poll 4: 6.75s
Poll 5+: 10s (capped)
```

## Error Handling

### Simulation Errors
Displayed in a code block with the exact error message from the RPC node. Provides "Edit Parameters" and "Retry" buttons.

**Example**:
```
Error Details:
Simulation failed: insufficient balance for fee
```

### Submission Errors
Shows the raw error response for debugging. No retry buttons (transaction may be partially processed).

### Confirmation Timeouts
Indicates the transaction was submitted but confirmation polling timed out. Provides the transaction hash for manual verification.

## Advanced Details Section

Collapsible section that reveals:

1. **Raw XDR**: Base64-encoded transaction envelope
2. **Format Badge**: Indicates XDR encoding (Base64)
3. **Copy Button**: One-click clipboard copy
4. **Security Warning**: Reminds users not to share sensitive XDRs

**When to use**: Debugging, sharing with support, manual transaction inspection.

## Styling

The component uses Tailwind CSS with a professional design system:

- **Monospace font**: System monospace for technical data (hashes, XDR)
- **Color palette**:
  - Success: Emerald (green)
  - Active: Amber (yellow/orange)
  - Error: Red
  - Neutral: Slate (gray)
- **Animations**: CSS keyframes for pulsing rings and progress bars
- **Responsive**: Works on mobile and desktop

### Custom Animations

```css
/* Pulsing ring on active step */
@keyframes ping {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Breathing effect */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

## Testing

Run the test suite:

```bash
npm test -- transaction-status-modal.test.tsx
```

### Test Coverage

- ✅ State machine logic (all step transitions)
- ✅ UI rendering for each lifecycle step
- ✅ Copy-to-clipboard functionality
- ✅ Advanced details expand/collapse
- ✅ Error handling and retry actions
- ✅ Polling behavior
- ✅ Ghost state (indexing)
- ✅ Close button behavior (disabled during active transactions)
- ✅ Block explorer link generation

## Adding New Lifecycle Steps

If the Stellar protocol adds new transaction phases:

1. **Update types** in `apps/web/lib/job-registry.ts`:
   ```typescript
   export type TxLifecycleStep =
     | "idle"
     | "building"
     | "simulating"
     | "signing"
     | "submitting"
     | "confirming"
     | "confirmed"
     | "failed"
     | "your-new-step"; // Add here
   ```

2. **Add step definition** in `transaction-status-modal.tsx`:
   ```typescript
   const STEPS: StepDef[] = [
     // ... existing steps
     { 
       key: "your-new-step", 
       label: "New Step", 
       icon: YourIcon,
       description: "What this step does"
     },
   ];
   ```

3. **Update step index**:
   ```typescript
   const STEP_INDEX: Record<TxLifecycleStep, number> = {
     // ... existing mappings
     "your-new-step": 5, // Assign position
   };
   ```

4. **Add status message**:
   ```typescript
   {isActive && (
     <div>
       {step === "your-new-step" && "Your new step message..."}
     </div>
   )}
   ```

5. **Update tests** to cover the new step.

## Performance Considerations

- **Lazy rendering**: Modal only renders when `isOpen && step !== "idle"`
- **Efficient polling**: Exponential backoff reduces RPC calls
- **Memoization**: Consider wrapping in `React.memo` if parent re-renders frequently
- **Cleanup**: Timers are properly cleared on unmount

## Accessibility

- **ARIA labels**: All interactive elements have descriptive labels
- **Keyboard navigation**: Full keyboard support for all actions
- **Focus management**: Modal traps focus when open
- **Screen readers**: Status updates are announced
- **Color contrast**: WCAG AA compliant (manual testing recommended)

## Security Notes

- **No private keys**: Component never displays or logs private keys
- **XDR warnings**: Security notice in advanced details section
- **External links**: Use `rel="noopener noreferrer"` for block explorer links
- **Input sanitization**: All user-provided data is escaped

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support (iOS 12+)
- Clipboard API: Requires HTTPS in production

## Troubleshooting

### Modal doesn't appear
- Check `isOpen` prop is `true`
- Verify `step` is not `"idle"`
- Ensure modal is not behind other elements (check z-index)

### Polling never completes
- Check RPC URL is correct
- Verify network connectivity
- Increase `POLL_MAX_RETRIES` if needed

### Copy button doesn't work
- Requires HTTPS in production
- Check browser clipboard permissions
- Fallback: Users can manually select and copy

### Animations are choppy
- Check for performance issues in parent components
- Reduce animation complexity if needed
- Consider `will-change` CSS property

## Future Enhancements

- [ ] WebSocket support for real-time updates (eliminate polling)
- [ ] Transaction history/replay
- [ ] Multi-transaction batching UI
- [ ] Custom theme support
- [ ] Internationalization (i18n)
- [ ] Accessibility audit with screen readers
- [ ] Performance profiling with React DevTools
