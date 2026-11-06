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
| `pnpm test:bench`                   | Timing tests against the spec targets, one file at a time     |
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
- The app backs the database up automatically once per day (Asia/Karachi) and after every shift close, to `backups/vendora-<timestamp>.db` in the user data folder. The copy runs on a worker thread, so billing does not wait for it. Each attempt is recorded in `backup_records`, and backups older than 30 days are deleted, always keeping the newest good one. `pre-migrate-*` files are never deleted. Each backup is also copied to a second folder chosen in Settings (a USB drive or a synced folder). That folder is per PC and saved in `terminals`, the copy outcome and its failure reason are saved on `backup_records`, and copy retention only deletes files named in those records. A failed copy never fails the backup or shows on the billing screen.
- The app backs the database up automatically once per day (Asia/Karachi) and after every shift close, to `backups/vendora-<timestamp>.db` in the user data folder. The copy runs on a worker thread, so billing does not wait for it. Each attempt is recorded in `backup_records`, and backups older than 30 days are deleted, always keeping the newest good one. `pre-migrate-*` files are never deleted.
- The Backup page in the back office lists the files in `backups/`, runs a backup on demand, and restores a backup from the list or from a file picked in a native dialog. A restore checks the file, copies it next to the database, runs the normal migrations on that copy, takes a `backups/pre-restore-<timestamp>.db` backup of the current data, records itself in the copy's audit log, and swaps it in with one rename before restarting. A failure leaves the current data in place. It is refused while a shift is open or bills are on hold.
- Tests run under Electron's Node (`ELECTRON_RUN_AS_NODE`), so `better-sqlite3` is built once for Electron.
- Fonts (Plus Jakarta Sans, JetBrains Mono, Noto Nastaliq Urdu) are bundled; nothing loads from the network.

## Billing screen

This answers design challenge 1. The layout follows Odoo POS `ProductScreen`: the bill is on the left, search and products are on the right, so the cashier's eyes stay on the lines and the total while the scanner works.

- **Layout.** The left 45% holds the bill lines, the totals, the numpad and the actions. The right holds one scan/search field and a product grid with category chips. The shift strip stays on top and the title bar shows the user. A printer item appears at the right end of the strip only when something needs attention: "No printer set up" when none is configured, or "Printer error" after a failed print or drawer kick. Click it, or press Enter on it, to open Settings at the printer card. The next successful print clears it. It never shows in the title bar.
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

F12 or the Pay button opens a separate payment step, as in Odoo POS `PaymentScreen`. Esc returns to the bill unchanged, and the payment lines and buyer details stay in memory until Validate. Nothing is saved before that. Pay is off for an empty bill. A bill with a negative total opens the refund step (see Returns and exchanges).

- **Methods.** Cash, Card, Bank transfer, JazzCash and Easypaisa, fixed. There is one line per method, and pressing a method again selects its line. A new line's amount is what is left to pay. The reference on card, bank and wallet lines is optional, and adding one focuses it.
- **Change.** Any method can overpay. The excess is stored as a cash change row, and the screen shows `Change` instead of `Left to pay`.
- **Quick tender.** Exact sets cash to the cash still due. The first 500, 1,000 or 5,000 press replaces the cash amount and later presses add to it. Typing an amount or adding a line starts a fresh run.
- **Rounding.** A Rounding row shows whenever it isn't zero. Under cash-only rounding it updates live with the lines. The default cash amount is rounded to the unit, and Validate refuses a cash amount that is not a multiple of it.
- **Validate.** Disabled while the bill is underpaid, and Enter shows `Rs N left to pay`. A zero-total bill validates with no lines. Paying more than 1,000 times the total asks for confirmation first. A double press makes one sale, because Validate is locked while it runs and main replays by draft.
- **Buyer details.** Optional and collapsed by default. Name is up to 100 characters. NTN is `1234567-8`, CNIC is `12345-1234567-1` (dashes optional, stored dashed), and phone is `03xxxxxxxxx` or `+923xxxxxxxxx`. Main checks the same formats. Values are kept on the sale only.
- **Scans.** A scanner burst on the payment screen is ignored with the error sound and never validates.
- **Receipt screen.** After Validate, "Sale saved" shows the invoice number with Total, Paid and Change. Enter, or a scan, starts the next bill, and the scan adds its item. The receipt prints after the sale is saved and the drawer has opened for any cash. "Printing…" shows while it runs. A failed print shows "Receipt didn't print" with Retry (Ctrl+P), and a missing printer shows "No printer set up" with a link to the settings. In ask mode a prompt shows first: Enter prints, Esc skips. A Print button (Ctrl+P) is always next to New bill.

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

## Returns and exchanges

Follows Odoo POS `TicketScreen` refunds. Find the sale on Orders, pick lines, press Refund, and the lines land on the current bill as negative lines. Scan new items into the same bill for an exchange, then pay or refund on the payment step.

- **One sale per bill.** Lines from a second sale are refused: "You can only return items from one sale per bill." There is no time limit, and sales from a closed shift can be returned. The refund counts toward the open shift.
- **Return picker.** Orders, Ctrl+R. Each line shows Sold, Refunded, Left and a Return box (kg and L take 3 decimals, pieces and packs whole units). "N on this bill" shows what is already on the current bill. Return lines of a sale can't be returned again. The quantity limit is checked again when the bill completes, so two held bills can't both return the last unit.
- **Amounts.** Taken from the original line's snapshot and split by quantity in integer paisa; the last return gets exactly the remainder. The original's rounding isn't refunded. The linked line carries the original name, price, cost, tax rate and pack. The average cost isn't touched.
- **Return without a receipt.** Ctrl+R on a bill line flips it to a negative line at the current price (and back). It takes no discount and is refunded in cash only. Ctrl+R on a line from a receipt is refused. The window does not reload on Ctrl+R in dev.
- **Back to shelf or Damaged.** Every return line has a toggle (Ctrl+D on the selected line). Back to shelf writes a `return` movement. Damaged writes a `return` and a `damage` movement together, so on-hand is unchanged. Misc items have no stock and no toggle.
- **Refund methods.** Cash, plus the non-cash methods the original sale used. Each is capped at the smallest of what it took minus what was already refunded to it, the refund owed on the linked lines, and the net refund. The rest is cash. An amount over the cap shows an inline error with the cap and Validate stays off. The amounts must add up to the refund exactly. Cash follows the rounding unit. Net above zero is a normal payment, and net zero completes with no payment row and no drawer kick.
- **Credit note.** Every bill with return lines prints "Credit note" (or "Exchange" when it nets to zero or more) with "Original invoice", negative quantities and its own invoice barcode, whatever the print mode. A failure shows Retry and never blocks the return. The receipt screen reads "Refund saved" with one Refund figure.
- **Audit.** Each return writes a `return` entry (counts, ids, amounts and refund by method). Returns without a receipt also write `return_without_receipt`.
- **Shifts.** Cash refunds lower expected cash, and refunds to other methods lower their expected totals. The X and Z reports count the return lines under Refunds.

| Key                | Action                                       |
| ------------------ | -------------------------------------------- |
| Ctrl+R (Orders)    | Open the return picker for the selected sale |
| Up / Down (picker) | Move between Return boxes                    |
| Enter (picker)     | Refund: add the lines to the bill            |
| Esc (picker)       | Back to Orders                               |
| Ctrl+R (bill)      | Flip the selected line to a return, and back |
| Ctrl+D (bill)      | Back to shelf or Damaged on a return line    |

## Receipts and printing

Target printers: Xprinter XP-58, Xprinter XP-80, Epson TM-T82 and Black Copper BC-85. The whole receipt is drawn as an image in a hidden, sandboxed window (so Urdu shapes correctly), dithered to 1 bit and sent as ESC/POS raster, 384 px wide on 58 mm and 576 px on 80 mm.

- **Connections.** A printer installed in Windows, sent raw through the spooler, or a network printer on TCP 9100. There is no USB driver layer. The Windows path calls `winspool.drv` through `koffi`, and checks the printer and its own job so an unplugged printer fails with Retry instead of queueing a duplicate.
- **Why koffi.** Node and Electron have no raw-spool API: `webContents.print` goes through the GDI driver and cannot send raster or a drawer kick. The native print addons (`printer`, `@thiagoelg/node-printer`) are unmaintained and need node-gyp for each Electron version, and starting PowerShell for each job costs about 1 s, which breaks the 1.5 s target. koffi ships prebuilt binaries and needs no build step. It loads only on Windows, when the first Windows job is sent.
- **Settings.** Back office, Settings, "Receipt printer": connection, paper width, print mode, Test print and Test drawer. "Receipt": store name, address, phone, NTN, STRN and the English and Urdu header and footer.
- **Drawer.** It opens for any sale with a cash payment row (tendered, change or refund), on cash in and cash out, and when the opening and closing counts begin. Every open without a sale is audit-logged with its reason. There is no free "open drawer" button.
- **Fake printer.** Run `VENDORA_FAKE_PRINTER=/tmp/vendora-prints pnpm dev` (or set the variable first on Windows). Each job writes `<time>-<n>-<kind>.bin` and `.png` to that folder, and each drawer kick adds a line to `drawer.log`. The variable is ignored in a packaged build.
- **Reprints.** Orders (Ctrl+O) lists the current shift. Reprints are rebuilt from the saved sale with the current header, are counted, and are not marked as duplicates.

| Key (Orders) | Action                                               |
| ------------ | ---------------------------------------------------- |
| Ctrl+O       | Open Orders from the bill                            |
| Enter        | Search the invoice number (digits only works: `231`) |
| Scan         | A scanned receipt barcode searches that invoice      |
| Up / Down    | Select a sale                                        |
| Ctrl+P       | Reprint the selected sale                            |
| Ctrl+R       | Return items from the selected sale                  |
| Esc          | Back to the bill, unchanged                          |

Ctrl+P also prints or retries on the receipt screen and prints the X-report and Z-report.

## Not included yet

Code signing, auto-update, product tables, and purchase returns to suppliers. Each arrives with its own change.
