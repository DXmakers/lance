# Freelancer Dashboard - Design System Documentation

A world-class Web3 freelancer dashboard with professional glassmorphism, strict design tokens, and high-contrast status indicators.

## Design Foundations

### Color Palette

```css
/* Base Colors */
--dashboard-bg: #09090b           /* zinc-950 */
--dashboard-surface: #18181b       /* zinc-900 */
--dashboard-surface-elevated: #27272a /* zinc-800 */

/* Status Colors (High Contrast) */
--dashboard-success: #10b981       /* emerald-500 */
--dashboard-warning: #f59e0b       /* amber-500 */
--dashboard-error: #ef4444         /* red-500 */
--dashboard-info: #3b82f6          /* blue-500 */

/* Text Colors */
--dashboard-text-primary: #fafafa     /* zinc-50 */
--dashboard-text-secondary: #a1a1aa   /* zinc-400 */
--dashboard-text-tertiary: #71717a    /* zinc-500 */
```

### Spacing Grid (8px Base)

```css
--space-1: 4px    /* 0.25rem */
--space-2: 8px    /* 0.5rem */
--space-3: 12px   /* 0.75rem */
--space-4: 16px   /* 1rem */
--space-5: 20px   /* 1.25rem */
--space-6: 24px   /* 1.5rem */
--space-8: 32px   /* 2rem */
--space-10: 40px  /* 2.5rem */
--space-12: 48px  /* 3rem */
```

### Border Radius

```css
--radius-sm: 8px   /* 0.5rem */
--radius-md: 12px  /* 0.75rem */
--radius-lg: 16px  /* 1rem */
--radius-xl: 24px  /* 1.5rem */
```

### Typography

```css
/* Font Families */
--font-sans: 'Inter', 'Geist', ui-sans-serif, system-ui, sans-serif
--font-mono: 'Geist Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace

/* Font Weights */
font-semibold: 600  /* Headers */
font-medium: 500    /* Labels */
font-normal: 400    /* Body text */

/* Special Typography Classes */
.text-financial     /* Monospace, tabular numbers for amounts */
.text-address       /* Monospace for crypto addresses */
.text-mono          /* General monospace text */
```

### Transitions

```css
--transition-fast: 150ms ease   /* Hover states, buttons */
--transition-base: 200ms ease   /* General transitions */
--transition-slow: 300ms ease   /* Complex animations */
```

## Components

### 1. GlassCard

Glassmorphic card with backdrop blur.

```tsx
import { GlassCard } from "@/components/dashboard/glass-card";

<GlassCard elevated interactive>
  {/* Content */}
</GlassCard>
```

**Props:**
- `elevated?: boolean` - Use elevated variant (zinc-800 with more blur)
- `interactive?: boolean` - Add hover effects and cursor pointer
- `className?: string` - Additional CSS classes
- `onClick?: () => void` - Click handler

**CSS Classes:**
- `.glass-card` - Base glassmorphic card
- `.glass-card-elevated` - Elevated variant
- `.card-interactive` - Interactive hover effects

### 2. StatusBadge

High-contrast status indicator.

```tsx
import { StatusBadge } from "@/components/dashboard/status-badge";

<StatusBadge status="success" label="Completed" size="md" />
```

**Props:**
- `status: "success" | "pending" | "error" | "info" | "active"` - Badge status
- `label?: string` - Custom label (defaults to status name)
- `showIcon?: boolean` - Show/hide icon (default: true)
- `size?: "sm" | "md" | "lg"` - Badge size (default: "md")
- `className?: string` - Additional CSS classes

**Status Colors:**
- `success` / `active` - Emerald-500 (green)
- `pending` - Amber-500 (yellow/orange)
- `error` - Red-500
- `info` - Blue-500

### 3. CopyAddressButton

Address display with copy-to-clipboard.

```tsx
import { CopyAddressButton } from "@/components/dashboard/copy-address-button";

<CopyAddressButton 
  address="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  truncateLength={8}
  showFullOnHover
/>
```

**Props:**
- `address: string` - Full address to display
- `truncateLength?: number` - Characters to show on each end (default: 8)
- `showFullOnHover?: boolean` - Show full address on hover (default: false)
- `className?: string` - Additional CSS classes

**Features:**
- Truncates to `0x1234...5678` format
- One-click copy with visual feedback
- Monospace font for technical data
- Optional hover tooltip with full address

### 4. ProgressBar

Animated progress indicator with shimmer.

```tsx
import { ProgressBar } from "@/components/dashboard/progress-bar";

<ProgressBar 
  value={3} 
  max={5} 
  showPercentage 
  size="md" 
/>
```

**Props:**
- `value: number` - Current progress value
- `max?: number` - Maximum value (default: 100)
- `showPercentage?: boolean` - Show percentage label (default: false)
- `size?: "sm" | "md" | "lg"` - Bar height (default: "md")
- `className?: string` - Additional CSS classes

**Features:**
- Smooth width transitions (200ms)
- Shimmer animation on fill
- Emerald gradient
- Accessible ARIA attributes

### 5. SparklineChart

Minimal SVG line chart for trends.

```tsx
import { SparklineChart } from "@/components/dashboard/sparkline-chart";

<SparklineChart 
  data={[2100, 2800, 2400, 3200, 2900, 3500]} 
  width={200} 
  height={48} 
/>
```

**Props:**
- `data: number[]` - Array of data points
- `width?: number` - Chart width in pixels (default: 200)
- `height?: number` - Chart height in pixels (default: 48)
- `className?: string` - Additional CSS classes

**Features:**
- Smooth curves using quadratic bezier
- Gradient area fill
- Emerald color scheme
- Responsive to data range

### 6. SidebarNavigation

Glassmorphic sidebar with navigation.

```tsx
import { SidebarNavigation } from "@/components/dashboard/sidebar-navigation";

<SidebarNavigation 
  activeItem="dashboard"
  onNavigate={(itemId) => console.log(itemId)}
/>
```

**Props:**
- `activeItem?: string` - Currently active nav item ID
- `onNavigate?: (itemId: string) => void` - Navigation callback
- `className?: string` - Additional CSS classes

**Features:**
- Glassmorphic background with backdrop blur
- Active state indicator (left border)
- Smooth hover transitions
- Mobile responsive with hamburger menu
- Fixed positioning on mobile, sticky on desktop

**Default Nav Items:**
- Dashboard
- Active Contracts
- Reputation
- Finances
- Settings
- Logout

### 7. EarningsOverviewCard

Primary earnings display with sparkline.

```tsx
import { EarningsOverviewCard } from "@/components/dashboard/earnings-overview-card";

<EarningsOverviewCard 
  data={{
    totalEarnings: 45250.75,
    pendingPayouts: 3500.00,
    recentIncome: [2100, 2800, 2400, 3200],
    currency: "USDC"
  }}
/>
```

**Props:**
- `data: EarningsData` - Earnings data object
- `className?: string` - Additional CSS classes

**EarningsData Interface:**
```typescript
interface EarningsData {
  totalEarnings: number;
  pendingPayouts: number;
  recentIncome: number[];
  currency?: string;
}
```

**Features:**
- Large financial display with monospace font
- Percentage change indicator
- Sparkline chart of recent income
- Pending payouts section
- Elevated glass card styling

### 8. ProjectCard

Individual project/contract card.

```tsx
import { ProjectCard } from "@/components/dashboard/project-card";

<ProjectCard 
  project={{
    id: "1",
    name: "DeFi Dashboard",
    clientAddress: "GXXX...XXX",
    status: "active",
    milestonesCompleted: 3,
    totalMilestones: 5,
    budget: 8500,
    deadline: "2026-05-15",
    currency: "USDC"
  }}
  onViewDetails={(id) => console.log(id)}
/>
```

**Props:**
- `project: ProjectData` - Project data object
- `onViewDetails?: (projectId: string) => void` - View details callback
- `className?: string` - Additional CSS classes

**ProjectData Interface:**
```typescript
interface ProjectData {
  id: string;
  name: string;
  clientAddress: string;
  status: "success" | "pending" | "error" | "active";
  milestonesCompleted: number;
  totalMilestones: number;
  budget: number;
  deadline?: string;
  currency?: string;
}
```

**Features:**
- Status badge with high-contrast colors
- Client address with copy button
- Milestone progress bar
- Budget and deadline display
- Interactive hover effects
- External link button

### 9. ReputationWidget

On-chain credentials and ratings.

```tsx
import { ReputationWidget } from "@/components/dashboard/reputation-widget";

<ReputationWidget 
  data={{
    rating: 4.8,
    totalReviews: 47,
    completedProjects: 52,
    successRate: 98,
    skills: ["Solidity", "React", "TypeScript"],
    badges: ["Top Rated", "Fast Delivery"]
  }}
/>
```

**Props:**
- `data: ReputationData` - Reputation data object
- `className?: string` - Additional CSS classes

**ReputationData Interface:**
```typescript
interface ReputationData {
  rating: number;
  totalReviews: number;
  completedProjects: number;
  successRate: number;
  skills: string[];
  badges?: string[];
}
```

**Features:**
- Star rating visualization (0-5 stars)
- Completed projects count
- Success rate percentage
- Achievement badges
- Skill tags with emerald accent
- Technical, trust-building design

## Layout System

### Responsive Grid

```css
.dashboard-grid {
  display: grid;
  gap: 24px;
  grid-template-columns: 1fr;
}

/* Tablet: 2 columns */
@media (min-width: 768px) {
  grid-template-columns: repeat(2, 1fr);
}

/* Desktop: 3 columns */
@media (min-width: 1280px) {
  grid-template-columns: repeat(3, 1fr);
}
```

### Main Layout Structure

```tsx
<div className="dashboard-bg-glow min-h-screen flex">
  {/* Sidebar: Fixed width, sticky */}
  <SidebarNavigation />
  
  {/* Main Content: Flex-1, scrollable */}
  <main className="flex-1 p-6 lg:p-8 custom-scrollbar overflow-y-auto">
    {/* Content */}
  </main>
</div>
```

## Glassmorphism

### Glass Card Variants

```css
/* Base Glass Card */
.glass-card {
  background: rgba(24, 24, 27, 0.6);  /* zinc-900 @ 60% */
  backdrop-filter: blur(16px);
  border: 1px solid rgba(63, 63, 70, 0.3);
  border-radius: 12px;
}

/* Elevated Glass Card */
.glass-card-elevated {
  background: rgba(39, 39, 42, 0.7);  /* zinc-800 @ 70% */
  backdrop-filter: blur(20px);
  border: 1px solid rgba(63, 63, 70, 0.4);
}

/* Glass Sidebar */
.glass-sidebar {
  background: rgba(24, 24, 27, 0.8);  /* zinc-900 @ 80% */
  backdrop-filter: blur(24px);
  border-right: 1px solid rgba(63, 63, 70, 0.3);
}
```

## Background Glow Effect

The dashboard uses a subtle radial gradient glow for depth:

```css
.dashboard-bg-glow::before {
  background: radial-gradient(
    circle at 20% 30%, 
    rgba(99, 102, 241, 0.08) 0%,  /* Indigo glow */
    transparent 50%
  ),
  radial-gradient(
    circle at 80% 70%, 
    rgba(148, 163, 184, 0.05) 0%,  /* Slate glow */
    transparent 50%
  );
}
```

**Usage:**
```tsx
<div className="dashboard-bg-glow">
  {/* Content */}
</div>
```

## Interactive Elements

### Button Styles

```tsx
/* Primary Button (Emerald) */
<button className="btn-primary">
  Submit
</button>

/* Secondary Button (Zinc) */
<button className="btn-secondary">
  Cancel
</button>

/* Copy Button */
<button className="copy-button">
  <Copy className="h-4 w-4" />
</button>
```

### Hover Effects

All interactive elements use 150ms transitions:

```css
button, a {
  transition: all 150ms ease;
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
}

.card-interactive:hover {
  transform: translateY(-2px);
  border-color: rgba(99, 102, 241, 0.4);
}
```

## Animations

### Fade In

```tsx
<div className="animate-fade-in">
  {/* Content fades in on mount */}
</div>
```

### Pulse Glow

```tsx
<div className="animate-pulse-glow">
  {/* Subtle pulsing glow effect */}
</div>
```

### Staggered Animation

```tsx
{items.map((item, index) => (
  <div 
    key={item.id}
    className="animate-fade-in"
    style={{ animationDelay: `${index * 50}ms` }}
  >
    {/* Content */}
  </div>
))}
```

## Testing

### Running Tests

```bash
cd apps/web
npm test -- status-badge.test.tsx
```

### Test Coverage

- ✅ Status badge color rendering
- ✅ Custom labels
- ✅ Icon visibility
- ✅ Size variants
- ✅ High-contrast validation
- ✅ Accessibility

## Performance

### Optimization Tips

1. **Use CSS transforms** for animations (GPU-accelerated)
2. **Lazy load** heavy components
3. **Memoize** expensive calculations
4. **Debounce** search inputs
5. **Virtualize** long lists

### 60fps Animations

All animations use CSS transforms and opacity for smooth 60fps:

```css
/* Good: GPU-accelerated */
transform: translateY(-2px);
opacity: 0.8;

/* Avoid: Causes reflow */
top: -2px;
height: 100px;
```

## Accessibility

### ARIA Labels

```tsx
<button aria-label="Copy address">
  <Copy />
</button>

<div role="progressbar" aria-valuenow={3} aria-valuemax={5}>
  {/* Progress bar */}
</div>
```

### Keyboard Navigation

All interactive elements support keyboard navigation:
- `Tab` - Navigate between elements
- `Enter` / `Space` - Activate buttons
- `Escape` - Close modals/menus

### Color Contrast

All text meets WCAG AA standards:
- Primary text: #fafafa on #09090b (19.8:1)
- Secondary text: #a1a1aa on #09090b (8.6:1)
- Status colors: High contrast variants used

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support (iOS 12+)
- Backdrop blur: Requires modern browser

## Migration Guide

### From Existing Dashboard

1. Import design system CSS:
```tsx
import "@/app/dashboard-design-system.css";
```

2. Replace existing cards with GlassCard:
```tsx
// Before
<div className="card">...</div>

// After
<GlassCard>...</GlassCard>
```

3. Update status indicators:
```tsx
// Before
<span className="status-success">Active</span>

// After
<StatusBadge status="active" />
```

4. Use monospace for financial data:
```tsx
<span className="text-financial">
  {formatCurrency(amount)}
</span>
```

## Examples

See `/app/dashboard/freelancer/page.tsx` for a complete implementation.

## Support

For issues or questions, check:
- Component source code in `/components/dashboard/`
- Test files in `/components/dashboard/__tests__/`
- Design system CSS in `/app/dashboard-design-system.css`
