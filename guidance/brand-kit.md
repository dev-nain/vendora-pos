# Brand Kit: Vendora

`design/tokens.css` holds every value below and is the source of truth. If this file and `tokens.css` disagree, `tokens.css` wins — fix this file. See every token and component rendered in `design/design-system.html`. The approved direction is kept as a working reference in `design/reference/fluent-prototype.html`. It loads nothing remote, and it is never bundled into the app.

## Mood & Tone

**Fluent: native, quiet, keyboard-first.** Vendora should look like it ships with Windows 11: a Mica background, layered surfaces, small 4 px controls, 8 px cards and dialogs, and one blue accent. Chrome stays out of the way, so the numbers and the next key press are what you notice.

- Native, not branded: Windows controls, Segoe UI, a custom title bar with the real caption buttons
- Quiet, not dull: colour only when it means something
- Keyboard first: every main action shows its key in the hint bar
- Local, not foreign: plain local words like Rs, JazzCash and Urdu product names

This is a tool a cashier uses 10 hours a day under time pressure in a bright shop. It should feel like part of the PC, not a website.

## Design Inspiration

- [Windows 11 / Fluent 2](https://fluent2.microsoft.design): layers, Mica, the accent underline on inputs, ContentDialog, list views, the selection pill, native caption buttons.
- [Shopify Polaris](https://polaris.shopify.com): semantic token naming, fill/text pairs, colour reserved for meaning. Study only, because Polaris's licence requires stand-alone apps to look visually distinct from Shopify. Never copy its look.
- [Square POS](https://squareup.com/us/en/point-of-sale) and [Loyverse](https://loyverse.com): checkout flow, shift reports, low-stock alerts.

## Token Naming

`--color-<property>-<role>-<state>`

| Part | Values |
|------|--------|
| Property | `bg`, `bg-surface` (panels), `bg-fill` (buttons, badges), `text`, `icon`, `border`, `input` |
| Role | `brand`, `secondary`, `success`, `warning`, `critical`, `info`, `neutral`, `highlight` |
| State | (default), `hover`, `active`, `selected`, `disabled` |

Rules:

- Components use only semantic tokens, never raw hex values.
- Every fill has a matching text token: `bg-fill-brand` → `text-on-brand`, `bg-fill-critical` → `text-on-critical`, `bg-fill-success` → `text-on-success`, `bg-fill-highlight` → `text-on-highlight`.
- Scales use one rule: **number ÷ 100 × 4 px** for space and radius names. `space-400` = 16px. Font sizes are literal pixels, named by step.

## Color Palette

**Accent blue means "act or selected"**: the main button, the input underline, the selection pill, the active tab and links. **Green, amber and red carry status only**, always with an icon or a word. Info is neutral: it isn't a status. There is no brand colour beyond the accent.

Layers, back to front: **Mica** (`bg`, the window) → **layer** (`bg-surface`, content areas) → **card** (`bg-surface-secondary`, cards, dialogs, flyouts).

### Light Mode

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#F3F3F3` | Mica: window background, title bar, nav |
| `--color-bg-surface` | `#FBFBFB` | Layer: content area, hint bar, dialog footer band |
| `--color-bg-surface-secondary` | `#FFFFFF` | Cards, dialogs, flyouts, focused inputs |
| `--color-bg-surface-hover` | `#F0F0F0` | Row and item hover |
| `--color-bg-surface-active` | `#EBEBEB` | Pressed surfaces |
| `--color-bg-surface-selected` | `#EAEAEA` | Selected row, tab or nav item (always with the selection pill) |
| `--color-bg-fill-brand` | `#005FB8` | Accent: primary button, selection pill, tab pill, app mark |
| `--color-bg-fill-brand-hover` | `#1A6FC0` | Accent hover |
| `--color-bg-fill-brand-active` | `#004C93` | Accent pressed |
| `--color-bg-fill-brand-disabled` | `#C5C5C5` | Accent disabled |
| `--color-bg-fill-secondary` | `#FFFFFF` | Secondary button, input, keycap |
| `--color-bg-fill-highlight` | `#FFF4CE` | Attention: held-bill count, notes |
| `--color-bg-fill-critical` | `#C42B1C` | Destructive button (Void) |
| `--color-bg-fill-success` | `#0F7B0F` | Money-in confirmations |
| `--color-text` | `#1A1A1A` | Primary text |
| `--color-text-secondary` | `#5C5C5C` | Body copy, descriptions, column headers |
| `--color-text-tertiary` | `#666666` | Metadata, barcodes, helper text, version |
| `--color-text-disabled` | `#A0A0A0` | Disabled labels |
| `--color-text-brand` / `-link` | `#005A9E` | Links, brand text |
| `--color-text-success` | `#0E700E` | Success text, badges |
| `--color-text-warning` | `#8A5300` | Low stock, pending |
| `--color-text-critical` | `#C42B1C` | Errors, negative amounts, refunds |
| `--color-text-on-highlight` | `#5C3B00` | Text on the attention fill |
| `--color-border` | `#EBEBEB` | Dividers, list-row rules |
| `--color-border-strong` | `#E0E0E0` | Control stroke, keycaps |
| `--color-input-border` | `#868686` | Input bottom stroke, PIN dot outlines (3:1 required) |
| `--color-border-focus` | `#000000` | Outer focus ring |
| `--color-border-card` | `#E5E5E5` | Card, dialog and layer edge |

Status surfaces for banners: `--color-bg-surface-success` `#DFF6DD`, `-warning` `#FFF4CE`, `-critical` `#FDE7E9`, `-info` `#F6F6F6`.

### Dark Mode

A full theme that follows the OS, not an inversion.

| Token | Hex |
|-------|-----|
| `--color-bg` | `#202020` |
| `--color-bg-surface` | `#272727` |
| `--color-bg-surface-secondary` | `#2C2C2C` |
| `--color-bg-surface-hover` | `#2F2F2F` |
| `--color-bg-surface-selected` | `#353535` |
| `--color-bg-fill-brand` | `#60CDFF` (text on it: `#000000`) |
| `--color-bg-fill-highlight` | `#433519` (text on it: `#FCE100`) |
| `--color-bg-fill-critical` | `#E5484D` (text on it: `#000000`) |
| `--color-bg-fill-success` | `#6CCB5F` (text on it: `#000000`) |
| `--color-text` | `#FFFFFF` |
| `--color-text-secondary` | `#CFCFCF` |
| `--color-text-tertiary` | `#ABABAB` |
| `--color-text-brand` | `#99EBFF` |
| `--color-text-warning` | `#FCE100` |
| `--color-text-critical` | `#FF99A4` |
| `--color-border` | `#333333` |
| `--color-border-strong` | `#3A3A3A` |
| `--color-input-border` | `#9A9A9A` |
| `--color-border-focus` | `#FFFFFF` |
| `--color-border-card` | `#1C1C1C` |

Theme follows the OS (`prefers-color-scheme`); there is no in-app switch. The `data-theme` attribute on `<html>` forces a theme for testing. The full dark set is in `tokens.css`.

### Contrast

Every text/background pair in both themes meets WCAG 2.1 AA (4.5:1 text; 3:1 icons, focus ring and input outlines). This is tested, not eyeballed: `src/main/tokens-contrast.test.ts` reads `tokens.css` and fails the build if a documented pair drops below AA in light or dark. It checks:

- `text`, `text-secondary`, `text-tertiary`, `text-brand`, `text-link` and `text-critical` on `bg`, `bg-surface` and `bg-surface-secondary`
- text on hover, active and selected surfaces (including `text-secondary` and `text-tertiary` on selected) and on secondary fills
- every `text-on-*` on its fill, including highlight
- every status text on its status surface and secondary fill
- `input-border`, `border-focus` (also on `bg-surface-secondary`), `border-critical-strong` and the icon colours at 3:1

Add the pair to the test when you add a token.

## Typography

### Font Stack

| Role | Font | Fallback |
|------|------|----------|
| Interface | **Segoe UI Variable Text** | Segoe UI Variable, Segoe UI, system-ui |
| Display (headings, amounts) | **Segoe UI Variable Display** | Segoe UI Variable, Segoe UI, system-ui |
| Codes | **Cascadia Mono** | Consolas, ui-monospace |
| Urdu | **Noto Nastaliq Urdu** (bundled) | Jameel Noori Nastaleeq |

Segoe UI ships with Windows 10 and 11, so it is always available offline and nothing Latin is bundled. Numbers a cashier compares (prices, quantities, totals, invoice numbers, PIN keys) use **tabular figures** (`tabular-nums`) in the interface font. Cascadia Mono is for barcodes and codes only.

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--font-size-1400` | 56px | Reserved for the largest totals |
| `--font-size-900` | 40px | Display: amount due, change due |
| `--font-size-700` | 28px | Title: page and auth headings |
| `--font-size-550` | 20px | Subtitle: dialog titles, PIN keys |
| `--font-size-450` | 16px | Scan field, large buttons |
| `--font-size-400` / `-350` | 14px | Body (Fluent base), buttons, labels, inputs |
| `--font-size-300` | 12px | Caption: hints, title-bar text, column headers, badges |

Line heights: `--line-height-normal` 1.43 (14/20), `--line-height-tight` 1.25. Tracking is 0 everywhere except `--letter-spacing-caps` (0.06em, 12px caps labels).

| Weight token | Value | Usage |
|--------------|-------|-------|
| `--font-weight-regular` | 400 | Body, labels, table headers |
| `--font-weight-medium` | 500 | Numbers on keys |
| `--font-weight-semibold` | 600 | Buttons, titles, selected tab, names |

## Money & Numbers

- `Rs` before the amount with a space; commas for thousands: `Rs 1,250,000`
- Whole rupees by default; paisa only when an amount has them: `Rs 727.63`
- Refunds and discounts: minus sign plus critical colour, e.g. `−Rs 80`
- Weights to 3 decimals with unit (`1.250 kg`); pieces as whole numbers (`12 pcs`)
- Numbers right-aligned in tables
- Dates: `27 Oct 2026, 4:05 pm`; receipts: `27-10-2026 4:05 PM`

## Spacing

4px base unit.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-100` | 4px | Icon gaps |
| `--space-200` | 8px | Inline gaps, button groups |
| `--space-300` | 12px | Compact spacing, tile gaps |
| `--space-400` | 16px | Standard spacing, cell padding |
| `--space-500` | 20px | Section gaps |
| `--space-600` | 24px | Card and dialog padding |
| `--space-800` | 32px | Section spacing, pane padding |
| `--space-1000` | 40px | Large padding |
| `--space-1200` | 48px | Large section breaks |
| `--space-1600` | 64px | Page-level spacing |

## Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `--height-control-sm` | 36px | Toolbars, dense tables (mouse only) |
| `--height-control-md` | 44px | Default control; minimum touch target |
| `--height-control-lg` | 52px | Pay, scan field |
| `--height-row` | 48px | List and bill rows |
| `--height-title-bar` | 44px | Custom title bar |
| `--height-hint-bar` | 36px | Hint bar |

Minimum supported screen: **1366×768**, no horizontal scroll. The Back office nav is 240px wide.

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-100` / `-200` | 4px | Controls: buttons, inputs, selects, tabs, menu items |
| `--radius-300` / `-400` / `-500` | 8px | Cards, user tiles, dialogs, flyouts, the layer's top-left corner |
| `--radius-full` | 999px | Avatars, PIN dots, the selection pill |

Keycaps use 3px.

## Shadows & Strokes

Cards are separated by a 1px `border-card` stroke; shadows are reserved for floating surfaces.

| Token | Light | Usage |
|-------|-------|-------|
| `--shadow-100` | `0 1px 2px rgb(0 0 0 / .04)` | Small lifts |
| `--shadow-200` | `0 8px 16px rgb(0 0 0 / .14)` | Flyouts: menus, select lists |
| `--shadow-300` | `0 32px 64px rgb(0 0 0 / .19)` + `0 2px 21px rgb(0 0 0 / .15)` | Dialogs |
| `--shadow-focus` | 1px surface gap + 2px `border-focus` ring | Keyboard focus on every control except inputs |

Dark mode uses black shadows at higher alpha (in `tokens.css`). Under `prefers-contrast: more`, cards get the strong border.

Inputs and selects do not use the ring. They show the Fluent accent underline: a 2px `border-brand` bottom edge on focus (`critical-strong` when invalid).

## Motion

Motion follows the hand and never delays a sale.

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-100` | 83ms | Colour changes, hover, press |
| `--duration-200` | 167ms | Dialog and flyout enter/exit |
| `--duration-300` | 250ms | Longer transitions |
| `--ease-out` | `cubic-bezier(0, 0, 0, 1)` | Fluent decelerate; `--ease-spring` is an alias |
| `--scale-press` | 1 | Fluent doesn't scale on press |
| `--scale-enter` | 1.05 | Dialog and flyout enter from 105% to 100% |

With `prefers-reduced-motion: reduce`, durations drop to 0 and `--scale-enter` becomes 1.

## Shell

- **Title bar:** 44px, on Mica, draggable. App mark and "Vendora" at 12px, the area tabs, then the user button. Windows draws the native caption buttons over the right edge, so the bar keeps clear padding there.
- **Tabs:** Sell and Back office (owner only), 44px high. The selected tab is semibold with a 16×3px accent pill under its label. `Ctrl+1` and `Ctrl+2` switch.
- **User button:** a 24px avatar and name. It opens a menu with Lock (`Ctrl+L`) and Log out.
- **Content layer:** `bg-surface` with an 8px top-left radius and a top and left `border-card` stroke, sitting on Mica.
- **Hint bar:** 36px, `bg-surface`, 12px `text-secondary`. Keycaps plus a label for each shortcut in the current area. It is plain text.
- **Selection pill:** selected rows, tiles and nav items get `bg-surface-selected` plus a 3×16px `bg-fill-brand` pill on the left edge. This is how selection avoids relying on colour alone.
- **Keycaps:** 11px semibold, 20px high, `bg-fill-secondary`, a 1px stroke with a 2px bottom.

## Icons & Visual Assets

### Icons

**Lucide**, 2px stroke. 16px inline, in nav items and in buttons, 20px in banners and PIN keys, 24px in empty states.

An icon never stands alone on an action. It has a visible label, or an accessible name plus a tooltip for icon-only buttons.

### Logo

- **Mark:** a 16px rounded square in `bg-fill-brand` with a white `V` (`text-on-brand`). It is the same in the title bar and on the auth screens.
- **Wordmark:** the word "Vendora" at regular weight next to the mark.
- Minimum mark size 16px. Ship the mark as the app and installer icon.

### Receipts

Printed in the printer's monospace font, black only. 48 characters per line on 80mm, 32 on 58mm. Urdu lines print as an image. Footer: `Vendora`

## Voice

| Do | Don't |
|----|-------|
| "Printer offline — check paper or cable. Sale saved." | "Error: ESC/POS write failed (code -4)." |
| "Pay", "Hold bill", "Close shift" | "Proceed to payment processing" |
| "Void sale T1-000231 (Rs 4,770)?" | "Are you sure?" |
| "Your limit is 5%. A manager can approve with their PIN." | "Invalid operation! You can't do that." |

## Principles

1. **The next scan is sacred.** Focus returns to the scan field after every action.
2. **Accent means act.** The main action, the input underline and selection are the accent blue, and nothing else is. Status colours never decorate.
3. **Numbers are the content.** Tabular figures, right-aligned; the total is the largest thing on screen.
4. **Keyboard first, touch friendly.** Every main action shows its key; every target is at least 44px.
5. **Failure degrades, never blocks.** Printer, network and backup problems are warnings; the sale completes.
6. **Never colour alone.** Status pairs colour with an icon and a word. Selection pairs the selected fill with the accent pill or a check.
7. **Motion answers the hand.** Press feedback is instant, motion settles without bounce, and reduced motion leaves only fades.

## Key Screens for Design Quality

1. **Billing screen**: where cashiers spend 90% of their time. Scan-to-line speed, readable totals, visible shortcuts.
2. **PIN login and lock**: a single centred column on Mica with the app mark top-left and the version bottom-left: user tiles, PIN dots and pad.
3. **Shift close / Z-report**: where trust is won or lost. Clear expected vs counted, no ambiguity.
4. **Owner dashboard**: two minutes at the end of the day; the important number must be obvious.

## Quality Spectrum

| Level | What it looks like for Vendora |
|-------|-------------------------------|
| **Adequate** | Sales work, numbers are correct, spacing is consistent. Looks like generic desktop software. |
| **Good** | Numbers align in columns, totals readable at arm's length, every action has a visible shortcut, errors say what to do. Looks like a real product. |
| **Excellent** | A trained cashier never touches the mouse. Nothing moves unexpectedly. Owners trust the numbers on sight. It feels faster than the paper register it replaced. |
