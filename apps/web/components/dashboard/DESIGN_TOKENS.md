# Design Tokens Reference

Quick reference for all design tokens used in the Freelancer Dashboard.

## Color Tokens

### Base Colors

| Token | Value | Hex | Usage |
|-------|-------|-----|-------|
| `--dashboard-bg` | zinc-950 | `#09090b` | Main background |
| `--dashboard-surface` | zinc-900 | `#18181b` | Card backgrounds |
| `--dashboard-surface-elevated` | zinc-800 | `#27272a` | Elevated cards |

### Status Colors (High Contrast)

| Token | Value | Hex | Usage |
|-------|-------|-----|-------|
| `--dashboard-success` | emerald-500 | `#10b981` | Success states, completion |
| `--dashboard-success-light` | emerald-400 | `#34d399` | Hover states |
| `--dashboard-success-dark` | emerald-600 | `#059669` | Active states |
| `--dashboard-warning` | amber-500 | `#f59e0b` | Pending, warnings |
| `--dashboard-warning-light` | amber-400 | `#fbbf24` | Hover states |
| `--dashboard-warning-dark` | amber-600 | `#d97706` | Active states |
| `--dashboard-error` | red-500 | `#ef4444` | Errors, failures |
| `--dashboard-info` | blue-500 | `#3b82f6` | Information |

### Text Colors

| Token | Value | Hex | Usage |
|-------|-------|-----|-------|
| `--dashboard-text-primary` | zinc-50 | `#fafafa` | Primary text, headers |
| `--dashboard-text-secondary` | zinc-400 | `#a1a1aa` | Secondary text, labels |
| `--dashboard-text-tertiary` | zinc-500 | `#71717a` | Tertiary text, hints |

### Border Colors

| Token | Value | Hex | Usage |
|-------|-------|-----|-------|
| `--dashboard-border` | zinc-800 | `#27272a` | Default borders |
| `--dashboard-border-light` | zinc-700 | `#3f3f46` | Lighter borders |

### Glow Effects

| Token | Value | Usage |
|-------|-------|-------|
| `--dashboard-glow-indigo` | `rgba(99, 102, 241, 0.08)` | Background glow (top-left) |
| `--dashboard-glow-slate` | `rgba(148, 163, 184, 0.05)` | Background glow (bottom-right) |

## Spacing Tokens (8px Grid)

| Token | Value | Pixels | Usage |
|-------|-------|--------|-------|
| `--space-1` | 0.25rem | 4px | Tight spacing, icon gaps |
| `--space-2` | 0.5rem | 8px | Base unit, small gaps |
| `--space-3` | 0.75rem | 12px | Medium gaps, padding |
| `--space-4` | 1rem | 16px | Standard spacing |
| `--space-5` | 1.25rem | 20px | Large spacing |
| `--space-6` | 1.5rem | 24px | Section spacing |
| `--space-8` | 2rem | 32px | Large sections |
| `--space-10` | 2.5rem | 40px | Extra large spacing |
| `--space-12` | 3rem | 48px | Maximum spacing |

## Border Radius Tokens

| Token | Value | Pixels | Usage |
|-------|-------|--------|-------|
| `--radius-sm` | 0.5rem | 8px | Small elements, badges |
| `--radius-md` | 0.75rem | 12px | Cards, buttons (default) |
| `--radius-lg` | 1rem | 16px | Large cards |
| `--radius-xl` | 1.5rem | 24px | Extra large containers |

## Typography Tokens

### Font Families

| Token | Value | Usage |
|-------|-------|-------|
| `--font-sans` | Inter, Geist, system-ui | UI text, labels |
| `--font-mono` | Geist Mono, SF Mono, Fira Code | Financial data, addresses |

### Font Weights

| Weight | Value | Usage |
|--------|-------|-------|
| `font-semibold` | 600 | Headers, titles |
| `font-medium` | 500 | Labels, nav items |
| `font-normal` | 400 | Body text |

### Font Sizes

| Class | Size | Usage |
|-------|------|-------|
| `text-xs` | 0.75rem (12px) | Small labels, captions |
| `text-sm` | 0.875rem (14px) | Body text, descriptions |
| `text-base` | 1rem (16px) | Default text |
| `text-lg` | 1.125rem (18px) | Large text |
| `text-xl` | 1.25rem (20px) | Subheadings |
| `text-2xl` | 1.5rem (24px) | Section headers |
| `text-3xl` | 1.875rem (30px) | Page titles |
| `text-4xl` | 2.25rem (36px) | Large numbers, earnings |

### Special Typography Classes

| Class | Purpose | Font | Weight |
|-------|---------|------|--------|
| `.text-financial` | Financial amounts | Mono | 600 |
| `.text-address` | Crypto addresses | Mono | 400 |
| `.text-mono` | Technical data | Mono | 400 |

## Transition Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | 150ms ease | Hover states, buttons |
| `--transition-base` | 200ms ease | General transitions |
| `--transition-slow` | 300ms ease | Complex animations |

## Shadow Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px 0 rgba(0, 0, 0, 0.3)` | Small elevation |
| `--shadow-md` | `0 4px 6px -1px rgba(0, 0, 0, 0.4)` | Medium elevation |
| `--shadow-lg` | `0 10px 15px -3px rgba(0, 0, 0, 0.5)` | Large elevation |
| `--shadow-glow` | `0 0 20px rgba(99, 102, 241, 0.15)` | Glow effect |

## Glassmorphism Tokens

### Background Opacity

| Surface | Background | Opacity | Blur |
|---------|-----------|---------|------|
| Glass Card | zinc-900 | 60% | 16px |
| Glass Card Elevated | zinc-800 | 70% | 20px |
| Glass Sidebar | zinc-900 | 80% | 24px |

### Border Opacity

| Surface | Border Color | Opacity |
|---------|-------------|---------|
| Glass Card | zinc-700 | 30% |
| Glass Card Elevated | zinc-700 | 40% |
| Glass Sidebar | zinc-700 | 30% |

## Usage Examples

### Spacing

```tsx
// Using spacing tokens
<div className="p-6">        {/* 24px padding */}
  <div className="mb-4">     {/* 16px margin-bottom */}
    <div className="gap-2">  {/* 8px gap */}
      {/* Content */}
    </div>
  </div>
</div>
```

### Colors

```tsx
// Using color tokens
<div className="bg-zinc-950">              {/* Background */}
  <div className="glass-card">             {/* Glassmorphic surface */}
    <h1 className="text-zinc-100">         {/* Primary text */}
      <span className="text-emerald-400">  {/* Success color */}
        Success
      </span>
    </h1>
  </div>
</div>
```

### Typography

```tsx
// Using typography tokens
<div>
  <h1 className="text-3xl font-semibold text-zinc-100">
    Dashboard
  </h1>
  <p className="text-sm font-medium text-zinc-400">
    Welcome back
  </p>
  <span className="text-financial text-4xl text-emerald-400">
    $45,250.75
  </span>
</div>
```

### Transitions

```tsx
// Using transition tokens
<button className="transition-all duration-150 hover:transform hover:-translate-y-1">
  Click me
</button>
```

## CSS Custom Properties

All tokens are available as CSS custom properties:

```css
.my-component {
  background: var(--dashboard-bg);
  color: var(--dashboard-text-primary);
  padding: var(--space-6);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
```

## Tailwind Classes

Most tokens have corresponding Tailwind classes:

```tsx
<div className="bg-zinc-950 text-zinc-100 p-6 rounded-xl transition-all duration-150">
  {/* Content */}
</div>
```

## Status Color Mapping

| Status | Color Token | Hex | Tailwind Class |
|--------|------------|-----|----------------|
| Success | `--dashboard-success` | `#10b981` | `text-emerald-500` |
| Active | `--dashboard-success` | `#10b981` | `text-emerald-500` |
| Pending | `--dashboard-warning` | `#f59e0b` | `text-amber-500` |
| Warning | `--dashboard-warning` | `#f59e0b` | `text-amber-500` |
| Error | `--dashboard-error` | `#ef4444` | `text-red-500` |
| Failed | `--dashboard-error` | `#ef4444` | `text-red-500` |
| Info | `--dashboard-info` | `#3b82f6` | `text-blue-500` |

## Responsive Breakpoints

| Breakpoint | Min Width | Usage |
|------------|-----------|-------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Large desktop |
| `2xl` | 1536px | Extra large |

## Grid Columns

| Breakpoint | Columns | Usage |
|------------|---------|-------|
| Mobile | 1 | Single column |
| Tablet (md) | 2 | Two columns |
| Desktop (xl) | 3 | Three columns |

## Z-Index Scale

| Layer | Value | Usage |
|-------|-------|-------|
| Base | 0 | Default content |
| Dropdown | 10 | Dropdowns, tooltips |
| Sticky | 20 | Sticky headers |
| Modal Overlay | 40 | Modal backgrounds |
| Modal | 50 | Modal content |

## Animation Durations

| Animation | Duration | Easing |
|-----------|----------|--------|
| Fade In | 300ms | ease-out |
| Pulse Glow | 2000ms | ease-in-out |
| Shimmer | 2000ms | linear |
| Hover | 150ms | ease |

## Accessibility

### Minimum Contrast Ratios

| Text Type | Ratio | Meets |
|-----------|-------|-------|
| Primary text | 19.8:1 | AAA |
| Secondary text | 8.6:1 | AA |
| Large text | 4.5:1 | AA |

### Focus Indicators

```css
:focus-visible {
  outline: 2px solid var(--dashboard-success);
  outline-offset: 2px;
}
```

## Print Styles

When printing, glassmorphism is removed:

```css
@media print {
  .glass-card {
    background: white;
    border: 1px solid black;
  }
}
```

## Dark Mode

The dashboard is dark-mode first. All tokens are optimized for dark backgrounds.

## Performance

- Use CSS transforms for animations (GPU-accelerated)
- Backdrop blur requires modern browser
- All transitions are 60fps capable
- SVG icons for crisp rendering at any size

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Backdrop blur | ✅ | ✅ | ✅ | ✅ |
| CSS Grid | ✅ | ✅ | ✅ | ✅ |
| Custom properties | ✅ | ✅ | ✅ | ✅ |
| Transforms | ✅ | ✅ | ✅ | ✅ |
