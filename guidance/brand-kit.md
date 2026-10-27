# Brand Kit: Vendora

`design/tokens.css` holds every value below and is the source of truth. If this file and `tokens.css` disagree, `tokens.css` wins — fix this file. See every token and component rendered in `design/design-system.html`.

## Mood & Tone

**Mono Pro: precise, quiet, fast.** Black, white and one indigo accent. The interface stays quiet so prices, totals and the next action stand out.

- Precise, not fussy — numbers line up, every value is exact
- Quiet, not cold — greys do the structure; colour only when it means something
- Fast, not flashy — every pixel serves the next scan
- Premium, not foreign — plain local words: Rs, JazzCash, Urdu product names

This is a tool a cashier uses 10 hours a day under time pressure in a bright shop. It should feel like a well-built till, not a website.

## Design Inspiration

- [Linear](https://linear.app) — Draw from: restraint, monochrome structure with one accent, crisp type.
- [Shopify Polaris](https://polaris.shopify.com) — Draw from: semantic token naming, fill/text pairs, colour reserved for meaning. Study reference only: Polaris's license requires stand-alone apps to look visually distinct from Shopify, so never copy its look. Notes in `design/reference/shopify-polaris.html`.
- [Square POS](https://squareup.com/us/en/point-of-sale) and [Loyverse](https://loyverse.com) — Draw from: checkout flow, shift reports, low-stock alerts.

## Token Naming

`--color-<property>-<role>-<state>`

| Part | Values |
|------|--------|
| Property | `bg`, `bg-surface` (panels), `bg-fill` (buttons, badges), `text`, `icon`, `border`, `input` |
| Role | `brand`, `secondary`, `success`, `warning`, `critical`, `info`, `inverse`, `neutral` |
| State | (default), `hover`, `active`, `selected`, `disabled` |

Rules:

- Components use only semantic tokens — never raw hex values.
- Every fill has a matching text token: `bg-fill-brand` → `text-on-brand`, `bg-fill-critical` → `text-on-critical`, `bg-fill-success` → `text-on-success`, `bg-surface-inverse` → `text-on-inverse`.
- Scales use one rule: **number ÷ 100 × 4 px**. `space-400` = 16px, `font-size-1400` = 56px.

## Color Palette

**Indigo means "act or selected"** — the main button, focus ring, selected row — and nothing else. Green, amber and red only carry status, always with an icon or a word. Info is neutral grey: it isn't a status.

### Light Mode (default)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#FAFAFA` | Page background |
| `--color-bg-surface` | `#FFFFFF` | Panels, tables, dialogs |
| `--color-bg-surface-secondary` | `#F4F4F5` | Table headers, sunken areas, keycaps |
| `--color-bg-surface-hover` | `#F4F4F5` | Row and item hover |
| `--color-bg-surface-selected` | `#EEF2FF` | Selected row (always with the indigo bar) |
| `--color-bg-surface-inverse` | `#09090B` | Total due panel, toasts |
| `--color-bg-fill-brand` | `#4F46E5` | Primary button (Pay, Approve) |
| `--color-bg-fill-brand-hover` | `#4338CA` | Primary hover |
| `--color-bg-fill-brand-secondary` | `#E0E7FF` | Brand badge ("Held") |
| `--color-bg-fill-secondary` | `#FFFFFF` | Secondary button |
| `--color-bg-fill-critical` | `#DC2626` | Destructive button (Void) |
| `--color-bg-fill-success` | `#15803D` | Change due, money-in confirmations |
| `--color-text` | `#09090B` | Primary text |
| `--color-text-secondary` | `#52525B` | Body copy, descriptions |
| `--color-text-tertiary` | `#66666E` | Metadata, barcodes, helper text |
| `--color-text-link` | `#4338CA` | Links |
| `--color-text-success` | `#15803D` | Success text, badges |
| `--color-text-warning` | `#A16207` | Low stock, pending |
| `--color-text-critical` | `#B91C1C` | Errors, negative amounts, refunds |
| `--color-border` | `#E4E4E7` | Dividers, panel borders |
| `--color-border-strong` | `#D4D4D8` | Secondary buttons, keycaps |
| `--color-input-border` | `#8A8A93` | Input, select and stepper outlines (3:1 required) |
| `--color-border-focus` | `#4F46E5` | Focus ring |

Status surfaces for banners: `--color-bg-surface-success` `#F0FDF4`, `-warning` `#FEFCE8`, `-critical` `#FEF2F2`, `-info` `#F4F4F5`.

### Dark Mode

| Token | Hex |
|-------|-----|
| `--color-bg` | `#09090B` |
| `--color-bg-surface` | `#18181B` |
| `--color-bg-surface-secondary` | `#1F1F23` |
| `--color-bg-surface-selected` | `#1E1B4B` |
| `--color-bg-surface-inverse` | `#FAFAFA` |
| `--color-bg-fill-brand` | `#818CF8` (text on it: `#09090B`) |
| `--color-bg-fill-critical` | `#DC2626` |
| `--color-bg-fill-success` | `#22C55E` (text on it: `#052E16`) |
| `--color-text` | `#FAFAFA` |
| `--color-text-secondary` | `#A1A1AA` |
| `--color-text-tertiary` | `#8E8E97` |
| `--color-text-critical` | `#F87171` |
| `--color-border` | `#27272A` |
| `--color-input-border` | `#71717A` |
| `--color-border-focus` | `#818CF8` |

Light is the default (bright shops). Dark is a full theme, chosen by the user; it follows the OS setting until they choose. The full dark set is in `tokens.css`.

### Contrast

Every text/background pair in both themes meets WCAG 2.1 AA (4.5:1 text, 3:1 icons, focus ring and input outlines). Re-run the check when a colour changes; never trade contrast for looks.

## Typography

### Font Stack

| Role | Font | Fallback |
|------|------|----------|
| Interface | **Geist** | Segoe UI, system-ui |
| Numbers | **Geist Mono** | Cascadia Mono, Consolas |
| Urdu | **Noto Nastaliq Urdu** | Jameel Noori Nastaleeq |

All fonts are bundled with the app — it must look right offline. Use Geist Mono for every number a cashier compares: prices, quantities, totals in tables, barcodes, invoice numbers.

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--font-size-1400` | 56px | Total due, change due |
| `--font-size-900` | 36px | Screen titles on large panels |
| `--font-size-700` | 28px | Page headings |
| `--font-size-550` | 22px | Dialog titles |
| `--font-size-450` | 18px | Scan field, large buttons |
| `--font-size-400` | 16px | Body, bill lines, inputs (default) |
| `--font-size-350` | 14px | Helper text, secondary actions |
| `--font-size-300` | 12px | Caps labels, column headers only |

Nothing a cashier must read goes below 14px.

### Line Heights & Weights

| Token | Value | Usage |
|-------|-------|-------|
| `--line-height-tight` | 1.15 | Headings, totals |
| `--line-height-normal` | 1.5 | Body |
| `--line-height-urdu` | 2.1 | Nastaliq text (needs the extra height) |
| `--font-weight-regular` | 400 | Body |
| `--font-weight-medium` | 500 | Buttons, labels |
| `--font-weight-semibold` | 600 | Headings, totals, wordmark |

## Money & Numbers

- `Rs` before the amount with a space; commas for thousands: `Rs 1,250,000`
- Whole rupees by default; paisa only when an amount has them: `Rs 727.63`
- Refunds and discounts: minus sign plus critical colour — `−Rs 80`
- Weights to 3 decimals with unit (`1.250 kg`); pieces as whole numbers (`12 pcs`)
- Numbers right-aligned in tables
- Dates: `27 Oct 2026, 4:05 pm`; receipts: `27-10-2026 4:05 PM`

## Spacing

4px base unit.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-100` | 4px | Icon gaps |
| `--space-200` | 8px | Inline gaps, button groups |
| `--space-300` | 12px | Compact spacing, panel gaps |
| `--space-400` | 16px | Standard spacing, cell padding |
| `--space-500` | 20px | Total panel padding |
| `--space-600` | 24px | Panel and dialog padding |
| `--space-800` | 32px | Section spacing |
| `--space-1200` | 48px | Large section breaks |
| `--space-1600` | 64px | Page-level spacing |

## Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `--height-control-sm` | 36px | Toolbars, dense tables — mouse only |
| `--height-control-md` | 44px | Default control; minimum touch target |
| `--height-control-lg` | 56px | Pay, tender buttons, scan field, keypad |
| `--height-row` | 48px | Table rows |

Minimum supported screen: **1366×768**, no horizontal scroll.

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-100` | 4px | Keycaps |
| `--radius-200` | 8px | Buttons, inputs, banners in lists |
| `--radius-300` | 12px | Panels, tables, dialogs, total panel |
| `--radius-full` | 999px | Badges, status dots |

## Shadows

Borders separate surfaces. Shadows only lift.

| Token | Light | Usage |
|-------|-------|-------|
| `--shadow-100` | `0 1px 2px rgb(9 9 11 / .05)` | Inputs, secondary buttons |
| `--shadow-200` | `0 4px 12px rgb(9 9 11 / .08), 0 1px 3px rgb(9 9 11 / .06)` | Menus, toasts |
| `--shadow-300` | `0 16px 40px rgb(9 9 11 / .16)` | Dialogs |
| `--shadow-focus` | 2px surface gap + 2px `border-focus` ring | Keyboard focus on every control |

Dark mode uses stronger black shadows (in `tokens.css`).

## Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-100` | 100ms | Hover, press |
| `--duration-200` | 200ms | Dialogs, toasts |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | All transitions |

Motion never delays a sale. `prefers-reduced-motion` sets durations to 0.

## Icons & Visual Assets

### Icons

**Lucide**, 2px stroke. 16px inline and in badges, 18px in buttons, 20px in banners, 24px in empty states.

An icon never stands alone on an action: it has a visible label, or an accessible name plus tooltip for icon-only buttons.

### Logo

- **Wordmark:** lowercase `vendora.` in Geist Semibold, tight tracking, indigo full stop.
- **Mark:** a `v` on a rounded square (`bg-surface-inverse`) with an indigo dot. Inverts in dark mode.
- Clear space: half the mark's width. Minimum size 16px. Ship the mark as the app and installer icon.

### Receipts

Printed in the printer's monospace font, black only. 48 characters per line on 80mm, 32 on 58mm. Urdu lines print as an image. Footer: `vendora.`

## Voice

| Do | Don't |
|----|-------|
| "Printer offline — check paper or cable. Sale saved." | "Error: ESC/POS write failed (code -4)." |
| "Pay", "Hold bill", "Close shift" | "Proceed to payment processing" |
| "Void sale T1-000231 (Rs 4,770)?" | "Are you sure?" |
| "Your limit is 5%. A manager can approve with their PIN." | "Invalid operation! You can't do that." |

## Principles

1. **The next scan is sacred.** Focus returns to the scan field after every action.
2. **Indigo means act.** Main action, focus and selection — nothing else is indigo.
3. **Numbers are the content.** Monospaced, right-aligned; the total is the largest thing on screen.
4. **Keyboard first, touch friendly.** Every main action shows its key; every target is at least 44px.
5. **Failure degrades, never blocks.** Printer, network and backup problems are warnings; the sale completes.
6. **Never colour alone.** Status pairs colour with an icon and a word; selection pairs tint with a bar.

## Key Screens for Design Quality

1. **Billing screen** — where cashiers spend 90% of their time. Scan-to-line speed, readable totals, visible shortcuts.
2. **Shift close / Z-report** — where trust is won or lost. Clear expected vs counted, no ambiguity.
3. **Owner dashboard** — two minutes at the end of the day; the important number must be obvious.

## Quality Spectrum

| Level | What it looks like for Vendora |
|-------|-------------------------------|
| **Adequate** | Sales work, numbers are correct, spacing is consistent. Looks like generic desktop software. |
| **Good** | Numbers align in columns, totals readable at arm's length, every action has a visible shortcut, errors say what to do. Looks like a real product. |
| **Excellent** | A trained cashier never touches the mouse. Nothing moves unexpectedly. Owners trust the numbers on sight. It feels faster than the paper register it replaced. |
