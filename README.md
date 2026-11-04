# Vendora

Offline-first desktop point-of-sale for general stores in Pakistan. One counter, one Windows PC, one local SQLite database.

## Requirements

- Node 24
- pnpm 10

## Setup

```sh
pnpm install
pnpm dev
```

`pnpm install` also builds `better-sqlite3` for Electron (`postinstall`) and installs the git hooks (`prepare`).

## Scripts

| Script                              | What it does                                                  |
| ----------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                          | Electron with renderer HMR                                    |
| `pnpm build`                        | Builds main, preload and renderer into `out/`                 |
| `pnpm package:win`                  | Builds and packages an NSIS installer into `dist/` (Windows)  |
| `pnpm typecheck`                    | `tsc` for the node and web projects                           |
| `pnpm lint`                         | oxlint                                                        |
| `pnpm format` / `pnpm format:check` | oxfmt                                                         |
| `pnpm test`                         | Vitest, run under Electron's Node so native modules match     |
| `pnpm db:generate`                  | Generates a drizzle migration into `drizzle/` from the schema |

## Layout

```
src/main/       main process: window, IPC handlers, database
src/preload/    contextBridge API (window.vendora)
src/renderer/   React app
src/shared/     IPC contract: Zod schemas and types
drizzle/        generated SQL migrations (committed)
design/         design tokens, imported by the renderer CSS
```

## Stack

Electron, electron-vite, React 19, TypeScript (strict), Tailwind v4, shadcn on Base UI, better-sqlite3 with drizzle-orm and drizzle-kit, Zod, oxlint and oxfmt, Vitest, lefthook, electron-builder (NSIS, x64).

- Tokens live in `design/tokens.css` and are used directly; Tailwind maps them to utilities in `src/renderer/src/styles.css`.
- The renderer has no Node access. It talks to main only through the typed functions on `window.vendora`; main validates every payload with Zod.
- SQLite runs in WAL mode with `synchronous = FULL`. Pending migrations first back the database up to `backups/pre-migrate-<timestamp>.db` in the user data folder.
- Tests run under Electron's Node (`ELECTRON_RUN_AS_NODE`), so `better-sqlite3` is built once for Electron.
- Fonts (Plus Jakarta Sans, JetBrains Mono, Noto Nastaliq Urdu) are bundled; nothing loads from the network.

## Billing screen

This answers design challenge 1. The layout follows Odoo POS `ProductScreen`: the bill is on the left, search and products are on the right, so the cashier's eyes stay on the lines and the total while the scanner works.

- **Layout.** The left 45% holds the bill lines, the totals, the numpad and the actions. The right holds one scan/search field and a product grid with category chips. The shift strip stays on top and the title bar shows the user. There is no printer indicator until printing exists.
- **Total.** The grand total is 56 px (`--font-size-1400`) with tabular figures and is the largest text on screen.
- **Shortcuts.** Every action shows its keycap on its button and in the hint bar. F6 to F9 keep their keycaps on the strip buttons only, because the whole set would overflow the hint bar at 1366 px.

| Key            | Action                                                     |
| -------------- | ---------------------------------------------------------- |
| F2             | Scan or search field                                       |
| F3 / F4 / F5   | Quantity, line discount, price of the selected line        |
| Shift+F4       | Bill discount                                              |
| F10 / F11      | Hold the bill and start a new one / held bills             |
| F12            | Pay (opens the payment step)                               |
| Ctrl+M         | Misc item, only when the setting is on                     |
| Up / Down, Del | Select a line, delete the selected line without asking     |
| Ctrl+Del       | Discard the bill after a confirmation that names the total |
| Esc            | Cancel the current field or prompt                         |

- **Number entry.** F3, F4 or F5 opens an inline field on the selected line with its text selected. Enter saves, Esc reverts, and focus returns to the scan field. The on-screen numpad edits the same field and has an Enter key so a touch-only counter can commit. In the quantity field, Backspace on an empty field sets `0`, and a second Backspace removes the line. The line discount defaults to %, and Tab switches it to Rs.
- **Scanning.** Enter sends the field text to the barcode lookup. Scans are handled one at a time, in order, with an ok or error sound. A scan that arrives while a prompt is open is queued and never typed into the prompt: a burst of 4 or more characters with gaps of 30 ms or less followed by Enter counts as a scan. Esc on a prompt drops only that item.
- **Interruptions.** A loose kg or litre barcode, or a kg/litre tile, opens a weight prompt with a live total. A price-embedded scale label sets its own quantity and is read-only. A pack barcode adds a pack line (`2 × Pack (24 pcs) at Rs 3,400`). An unknown barcode shows an inline message under the field, plays the error sound, clears after 4 s or on the next scan, and never blocks the next scan.
- **Mistyped quantity.** Typed quantities of 100 or more (pieces and packs) or 25 or more (kg and litres) ask for confirmation with a message that names the total, for example `Set quantity to 100 × Lux Soap (Rs 15,000)?`. Scan increments never ask, so a normal sale is not slowed.
- **Held bills.** F10 holds the bill and starts a new one. F11 lists held-at, cashier, item count, total and the first item names. Enter resumes, and resuming holds the current bill. The last open bill and every held bill come back after a restart. Bills have no names. Discarding from the list asks first and is audited.

## Payment step

F12 or the Pay button opens a separate payment step, as in Odoo POS `PaymentScreen`. Esc returns to the bill unchanged, and the payment lines and buyer details stay in memory until Validate. Nothing is saved before that. Pay is off for an empty bill and for a bill with a negative total (refunds come later).

- **Methods.** Cash, Card, Bank transfer, JazzCash and Easypaisa, fixed. There is one line per method, and pressing a method again selects its line. A new line's amount is what is left to pay. The reference on card, bank and wallet lines is optional, and adding one focuses it.
- **Change.** Any method can overpay. The excess is stored as a cash change row, and the screen shows `Change` instead of `Left to pay`.
- **Quick tender.** Exact sets cash to the cash still due. The first 500, 1,000 or 5,000 press replaces the cash amount and later presses add to it. Typing an amount or adding a line starts a fresh run.
- **Rounding.** A Rounding row shows whenever it isn't zero. Under cash-only rounding it updates live with the lines. The default cash amount is rounded to the unit, and Validate refuses a cash amount that is not a multiple of it.
- **Validate.** Disabled while the bill is underpaid, and Enter shows `Rs N left to pay`. A zero-total bill validates with no lines. Paying more than 1,000 times the total asks for confirmation first. A double press makes one sale, because Validate is locked while it runs and main replays by draft.
- **Buyer details.** Optional and collapsed by default. Name is up to 100 characters. NTN is `1234567-8`, CNIC is `12345-1234567-1` (dashes optional, stored dashed), and phone is `03xxxxxxxxx` or `+923xxxxxxxxx`. Main checks the same formats. Values are kept on the sale only.
- **Scans.** A scanner burst on the payment screen is ignored with the error sound and never validates.
- **Receipt screen.** After Validate, "Sale saved" shows the invoice number with Total, Paid and Change. Enter, or a scan, starts the next bill, and the scan adds its item. Drawer and printing arrive with the receipt work.

| Key           | Action                                              |
| ------------- | --------------------------------------------------- |
| F2 to F6      | Cash, Card, Bank transfer, JazzCash, Easypaisa      |
| F7            | Exact amount for cash                               |
| F8 / F9 / F10 | Cash 500 / 1,000 / 5,000                            |
| F11           | Buyer details                                       |
| Up / Down     | Select a payment line                               |
| Del           | Remove the selected line                            |
| Digits        | Replace the selected amount                         |
| Enter         | Validate (in a reference field: back to the amount) |
| Esc           | Back to the bill                                    |

The shift strip is hidden on the payment and receipt screens, and F6 to F9 do not reach it there.

## Not included yet

Code signing, auto-update, and product tables. Each arrives with its own change.
