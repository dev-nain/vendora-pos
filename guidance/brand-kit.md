# Brand Kit: Vendora

`design/tokens.css` holds every value below and is the source of truth. If this file and `tokens.css` disagree, `tokens.css` wins — fix this file. See every token and component rendered in `design/design-system.html`. The approved direction is kept as a working reference in `design/reference/bazaar-prototype.html` (direction B). It loads Google Fonts, so it stays a reference file and is never bundled into the app.

## Mood & Tone

**Bazaar: warm, calm, sure-footed.** Cream paper, deep emerald for the next action, saffron for what's set aside. Roomy rows, soft corners and warm shadows, so a long shift feels easy on the eyes and the numbers still stand out.

- Warm, not cute: cream and emerald, never candy colours
- Calm, not dull: colour only when it means something
- Fast, not flashy: motion answers the hand instantly and settles without bounce
- Local, not foreign: plain local words like Rs, JazzCash and Urdu product names

This is a tool a cashier uses 10 hours a day under time pressure in a bright shop. It should feel like a well-kept shop counter, not a website.

## Design Inspiration

- Apple Human Interface Guidelines: instant press feedback, critically damped motion, translucent materials over content, motion that can be interrupted.
- [Shopify Polaris](https://polaris.shopify.com): semantic token naming, fill/text pairs, colour reserved for meaning. Study only, because Polaris's licence requires stand-alone apps to look visually distinct from Shopify. Never copy its look.
- [Square POS](https://squareup.com/us/en/point-of-sale) and [Loyverse](https://loyverse.com): checkout flow, shift reports, low-stock alerts.

## Token Naming

`--color-<property>-<role>-<state>`

| Part | Values |
|------|--------|
| Property | `bg`, `bg-surface` (panels), `bg-fill` (buttons, badges), `bg-tint` (product tiles), `bg-material`, `text`, `icon`, `border`, `input` |
| Role | `brand`, `secondary`, `success`, `warning`, `critical`, `info`, `inverse`, `neutral`, `highlight` |
| State | (default), `hover`, `active`, `selected`, `disabled` |

Rules:

- Components use only semantic tokens, never raw hex values.
- Every fill has a matching text token: `bg-fill-brand` → `text-on-brand`, `bg-fill-critical` → `text-on-critical`, `bg-fill-success` → `text-on-success`, `bg-fill-highlight` → `text-on-highlight`, `bg-surface-inverse` → `text-on-inverse` and `text-on-inverse-secondary`, `bg-tint-N` → `text-tint-N`.
- Scales use one rule: **number ÷ 100 × 4 px**. `space-400` = 16px, `font-size-1400` = 56px.

## Color Palette

**Emerald means "act or selected"**: the main button, focus ring, selected tile or row, and nothing else. **Saffron means "set aside, take a second look"**: held bills and notes. It is never a status. Green, amber and red carry status only, always with an icon or a word. Info is neutral: it isn't a status.

### Light Mode (default)

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#F2EEE6` | Page background (cream paper), top bar |
| `--color-bg-surface` | `#FFFDF8` | Cards, tables, dialogs, keys, tiles |
| `--color-bg-surface-secondary` | `#F7F3EB` | Sunken areas, keycaps, dialog side panels |
| `--color-bg-surface-hover` | `#F2ECE1` | Row and item hover |
| `--color-bg-surface-active` | `#E9E1D2` | Pressed surfaces |
| `--color-bg-surface-selected` | `#E3F1EC` | Selected row or tile (always with a bar, border or check) |
| `--color-bg-surface-inverse` | `#0E3B30` | Total due, login side panel |
| `--color-bg-fill-brand` | `#0E6B53` | Primary button (Pay, Unlock, Approve) |
| `--color-bg-fill-brand-hover` | `#0B5A45` | Primary hover |
| `--color-bg-fill-brand-active` | `#094A39` | Primary pressed |
| `--color-bg-fill-brand-disabled` | `#A9CFC2` | Primary disabled |
| `--color-bg-fill-brand-secondary` | `#E3F1EC` | Brand badge, avatar |
| `--color-bg-fill-secondary` | `#FFFDF8` | Secondary button |
| `--color-bg-fill-highlight` | `#F6D9A3` | Saffron: held-bill count, notes |
| `--color-bg-fill-critical` | `#B4381F` | Destructive button (Void) |
| `--color-bg-fill-success` | `#0E6B53` | Change due, money-in confirmations |
| `--color-text` | `#1D1A16` | Primary text |
| `--color-text-secondary` | `#554E44` | Body copy, descriptions |
| `--color-text-tertiary` | `#6E665A` | Metadata, barcodes, helper text, column headers |
| `--color-text-disabled` | `#A39A8C` | Disabled labels |
| `--color-text-brand` / `-link` | `#0B5A45` | Brand text, links |
| `--color-text-success` | `#0B5A45` | Success text, badges |
| `--color-text-warning` | `#8A5A00` | Low stock, pending |
| `--color-text-critical` | `#A8321F` | Errors, negative amounts, refunds |
| `--color-text-on-inverse` | `#FFFDF8` | Text on the inverse panel |
| `--color-text-on-inverse-secondary` | `#B9D3CA` | Labels and facts on the inverse panel |
| `--color-text-on-highlight` | `#5C3B00` | Text on saffron |
| `--color-border` | `#E6DFD2` | Dividers, dashed row rules |
| `--color-border-strong` | `#D5CCBB` | Secondary buttons, keycaps |
| `--color-input-border` | `#8C8272` | Input, select, PIN dot outlines (3:1 required) |
| `--color-border-focus` | `#0E6B53` | Focus ring |

Status surfaces for banners: `--color-bg-surface-success` `#E3F1EC`, `-warning` `#FBF0D9`, `-critical` `#FBE9E4`, `-info` `#F7F3EB`.

### Dark Mode ("Bazaar night")

A full theme, not an inversion. The inverse panel stays deep emerald.

| Token | Hex |
|-------|-----|
| `--color-bg` | `#101814` |
| `--color-bg-surface` | `#16201C` |
| `--color-bg-surface-secondary` | `#1C2823` |
| `--color-bg-surface-hover` | `#1F2C26` |
| `--color-bg-surface-selected` | `#173A30` |
| `--color-bg-surface-inverse` | `#0B2E25` |
| `--color-bg-fill-brand` | `#3FB58F` (text on it: `#04261C`) |
| `--color-bg-fill-highlight` | `#5A4318` (text on it: `#F6D9A3`) |
| `--color-bg-fill-critical` | `#C2452B` (text on it: `#FFFFFF`) |
| `--color-bg-fill-success` | `#3FB58F` (text on it: `#04261C`) |
| `--color-text` | `#F3EFE6` |
| `--color-text-secondary` | `#B9C2BC` |
| `--color-text-tertiary` | `#97A39C` |
| `--color-text-brand` | `#6FD0AE` |
| `--color-text-warning` | `#E8B85C` |
| `--color-text-critical` | `#F08A73` |
| `--color-border` | `#27332E` |
| `--color-border-strong` | `#33413A` |
| `--color-input-border` | `#6F7D76` |
| `--color-border-focus` | `#3FB58F` |

Light is the default (bright shops). Dark is a full theme chosen by the user. It follows the OS setting until they choose. The full dark set is in `tokens.css`.

### Product Tints

Six category tint pairs colour the product initial tiles (`TP`, `OL`) on bill lines and product lists. They help the eye find a line, and the product name always sits next to them. Every pair passes 4.5:1.

| Pair | Light bg / text | Dark bg / text |
|------|-----------------|----------------|
| `tint-1` saffron | `#F6D9A3` / `#5C3B00` | `#3A2C12` / `#F6D9A3` |
| `tint-2` blue | `#DCEBF7` / `#1F4A6E` | `#17293A` / `#BCD8F0` |
| `tint-3` clay | `#F3E2D3` / `#6B3A12` | `#33241A` / `#EBCDB3` |
| `tint-4` leaf | `#E8EFD9` / `#3F5317` | `#232E16` / `#CFE0AE` |
| `tint-5` rose | `#F7DADA` / `#7A1F1F` | `#3A1C1C` / `#F2BDBD` |
| `tint-6` indigo | `#DDE3F8` / `#25307A` | `#1D2340` / `#C4CEF5` |

### Contrast

Every text/background pair in both themes meets WCAG 2.1 AA (4.5:1 text; 3:1 icons, focus ring and input outlines). This is tested, not eyeballed: `src/main/tokens-contrast.test.ts` reads `tokens.css` and fails the build if a documented pair drops below AA in light or dark. It checks:

- `text`, `text-secondary`, `text-tertiary`, `text-brand`, `text-link` and `text-critical` on `bg`, `bg-surface` and `bg-surface-secondary`
- text on hover, active and selected surfaces and on secondary fills
- every `text-on-*` on its fill, including inverse, inverse-secondary and highlight
- every status text on its status surface and secondary fill
- every `text-tint-N` on `bg-tint-N`
- `input-border`, `border-focus`, `border-critical-strong` and the icon colours at 3:1

Add the pair to the test when you add a token.

## Typography

### Font Stack

| Role | Font | Fallback |
|------|------|----------|
| Interface | **Plus Jakarta Sans** (variable, 200–800) | Segoe UI, system-ui |
| Numbers | **JetBrains Mono** (variable, 100–800) | Cascadia Mono, Consolas |
| Urdu | **Noto Nastaliq Urdu** | Jameel Noori Nastaleeq |

All fonts are bundled with the app from `@fontsource-variable/*` and `@fontsource/*`, so it looks right offline. Use JetBrains Mono for every number a cashier compares: prices, quantities, totals, barcodes, invoice numbers, PIN keys and the clock.

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--font-size-1400` | 56px | Total due, change due |
| `--font-size-900` | 36px | Big numbers on side panels |
| `--font-size-700` | 28px | Page headings, side-panel wordmark |
| `--font-size-550` | 22px | Dialog titles, PIN keys |
| `--font-size-450` | 18px | Scan field, large buttons, top-bar wordmark |
| `--font-size-400` | 16px | Body, bill lines, inputs (default) |
| `--font-size-350` | 14px | Buttons, labels, helper text |
| `--font-size-300` | 12px | Column headers, badges, keycaps only |

Nothing a cashier must read goes below 14px.

### Tracking, Line Heights & Weights

| Token | Value | Usage |
|-------|-------|-------|
| `--letter-spacing-display` | -0.035em | 56px totals |
| `--letter-spacing-heading` | -0.02em | 22–36px headings |
| `--letter-spacing-tight` | -0.025em | Wordmark |
| `--letter-spacing-caps` | 0.06em | 12px caps labels |
| `--line-height-tight` | 1.15 | Headings, totals |
| `--line-height-normal` | 1.5 | Body |
| `--line-height-urdu` | 2.1 | Nastaliq text (needs the extra height) |
| `--font-weight-regular` | 400 | Body |
| `--font-weight-medium` | 500 | Numbers on keys, clock |
| `--font-weight-semibold` | 600 | Buttons, labels, names |
| `--font-weight-bold` | 700 | Headings, totals |
| `--font-weight-extrabold` | 800 | Wordmark only |

Body text has no tracking.

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
| `--space-400` | 16px | Standard spacing, cell padding, side-panel margin |
| `--space-500` | 20px | Top-bar padding, total panel padding |
| `--space-600` | 24px | Card and dialog padding, pane gaps |
| `--space-800` | 32px | Section spacing, pane padding |
| `--space-1000` | 40px | Side-panel padding |
| `--space-1200` | 48px | Large section breaks |
| `--space-1600` | 64px | Page-level spacing |

## Sizes

| Token | Value | Usage |
|-------|-------|-------|
| `--height-control-sm` | 36px | Toolbars, dense tables (mouse only) |
| `--height-control-md` | 44px | Default control; minimum touch target |
| `--height-control-lg` | 56px | Pay, tender buttons, scan field, PIN keys |
| `--height-row` | 56px | Table and bill rows |

Minimum supported screen: **1366×768**, no horizontal scroll. The top bar is 64px. The login side panel is 520px wide.

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-100` | 6px | Keycaps, small chips |
| `--radius-200` | 10px | Product thumbs, steppers, menu items |
| `--radius-300` | 14px | Buttons, inputs, selects, PIN keys, menus |
| `--radius-400` | 20px | Cards, tables, user tiles, dialogs |
| `--radius-500` | 28px | Large hero panels (login side panel) |
| `--radius-full` | 999px | Badges, avatars, PIN dots |

## Shadows & Materials

In light mode, shadows carry the edge of a card, so cards have no border (`--color-border-card` is transparent). In dark mode, cards keep a hairline because shadows barely show on a dark ground.

| Token | Light | Usage |
|-------|-------|-------|
| `--shadow-100` | `0 1px 2px rgb(60 40 10 / .06)` | Small lifts |
| `--shadow-200` | `--shadow-100` + `0 6px 20px rgb(60 40 10 / .06)` | Cards, tiles, keys, tables |
| `--shadow-300` | `0 24px 60px rgb(40 25 5 / .18)` + a 2px contact shadow | Dialogs, menus |
| `--shadow-focus` | 2px surface gap + 3px `border-focus` ring | Keyboard focus on every control |

Dark mode uses black shadows at higher alpha (in `tokens.css`).

**Materials** are translucent surfaces for floating chrome over content: sticky table headers and sheets (held bills).

| Token | Light | Dark |
|-------|-------|------|
| `--color-bg-material` | `rgb(255 253 248 / .74)` | `rgb(22 32 28 / .72)` |
| `--blur-material` | 24px | 24px |

Pair the material with `backdrop-filter: blur(var(--blur-material)) saturate(170%)`. With `prefers-reduced-transparency: reduce` or `prefers-contrast: more`, `tokens.css` swaps the material for the solid surface and turns the blur off. Under `prefers-contrast: more`, cards also get a strong border.

## Motion

Motion follows the hand and never delays a sale.

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-100` | 100ms | Pointer-down press, hover |
| `--duration-200` | 200ms | Fades, exits of menus |
| `--duration-300` | 350ms | Dialog and menu enter/exit |
| `--duration-release` | 220ms | Release after a press |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Colour changes, fades, release |
| `--ease-spring` | `linear(…)` | Enter/exit: a critically damped spring (damping 1, response 0.35 s) sampled over `--duration-300` |
| `--scale-press` | 0.97 | Press feedback |
| `--scale-enter` | 0.96 | Dialog and menu enter/exit |

- **Press feedback is instant.** On pointer-down, buttons, PIN keys, user tiles and select triggers scale to `--scale-press` over `--duration-100`, then release over `--duration-release`. `touch-action: manipulation` removes the tap delay.
- **Dialogs grow from their trigger.** They scale from `--scale-enter` and fade in, with the transform origin at the trigger's centre, and leave the same way.
- **Reduced motion keeps fades only.** With `prefers-reduced-motion: reduce`, both scale tokens become 1, the spring falls back to `--ease-out` and press timing drops to 0. Opacity fades stay, so state changes are still visible.

### Springs for gestures (later)

Gesture work (held-bills sheet, checkout) uses a small spring driven by **damping** and **response**, the same parameters as Apple's SwiftUI springs. There's no animation library: the spring is about 30 lines and lives with the feature that needs it. The prototype has a working reference.

| Motion | Response | Damping | Notes |
|--------|----------|---------|-------|
| Dialog open | 0.38 s | 1 | Grows from the trigger |
| Dialog close | 0.32 s | 1 | Returns to the trigger |
| Sheet open/close | 0.36 s / 0.32 s | 1 | Translate on x |
| Sheet release after a drag | 0.32 s | 0.85 | Hands off the release velocity, so it carries the flick |
| Total due counting | 0.45 s | 1 | Animate the number, never the layout |
| Wrong-PIN shake | 0.45 s | 0.25 | Kicked with a sideways velocity |

Rules: animate from the live value, so a spring can be interrupted mid-flight. Project a flick's end point (`v / 1000 × 0.998 / 0.002`) to decide open or closed. Rubber-band past the edges. Use about 8px of drag before committing to a direction. With reduced motion, jump to the target.

## Icons & Visual Assets

### Icons

**Lucide**, 2px stroke. 16px inline and in badges, 18px in buttons, 20px in banners and PIN keys, 24px in empty states.

An icon never stands alone on an action. It has a visible label, or an accessible name plus a tooltip for icon-only buttons.

### Logo

- **Wordmark:** lowercase `vendora.` in Plus Jakarta Sans ExtraBold with tight tracking (`--letter-spacing-tight`). The full stop is emerald (`bg-fill-brand`), or saffron on the inverse panel.
- **Mark:** a lowercase `v` on a square with 28% corner radius, in the inverse colour, with an emerald dot.
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
2. **Emerald means act.** Main action, focus and selection are emerald, and nothing else is. Saffron sets things aside; it never signals status.
3. **Numbers are the content.** Monospaced, right-aligned; the total is the largest thing on screen.
4. **Keyboard first, touch friendly.** Every main action shows its key; every target is at least 44px.
5. **Failure degrades, never blocks.** Printer, network and backup problems are warnings; the sale completes.
6. **Never colour alone.** Status pairs colour with an icon and a word. Selection pairs tint with a bar, a heavier border or a check.
7. **Motion answers the hand.** Press feedback is instant, motion settles without bounce, and reduced motion leaves only fades.

## Key Screens for Design Quality

1. **Billing screen**: where cashiers spend 90% of their time. Scan-to-line speed, readable totals, visible shortcuts.
2. **PIN login and lock**: the split layout, with the inverse panel on the left (wordmark, clock, facts) and user tiles, PIN dots and pad on the right.
3. **Shift close / Z-report**: where trust is won or lost. Clear expected vs counted, no ambiguity.
4. **Owner dashboard**: two minutes at the end of the day; the important number must be obvious.

## Quality Spectrum

| Level | What it looks like for Vendora |
|-------|-------------------------------|
| **Adequate** | Sales work, numbers are correct, spacing is consistent. Looks like generic desktop software. |
| **Good** | Numbers align in columns, totals readable at arm's length, every action has a visible shortcut, errors say what to do. Looks like a real product. |
| **Excellent** | A trained cashier never touches the mouse. Nothing moves unexpectedly. Owners trust the numbers on sight. It feels faster than the paper register it replaced. |
