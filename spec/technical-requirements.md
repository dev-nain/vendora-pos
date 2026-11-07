# Technical Requirements

## Platform

Windows desktop app, installed per store. v1 targets Windows 10 and 11 (64-bit).

| Area | Choice |
|------|--------|
| Shell | **Electron** |
| UI | React 19 + TypeScript + Tailwind v4 |
| Database | **SQLite** (WAL mode), accessed only from the Electron main process |
| Validation | Zod at every trust boundary (IPC calls, imports, settings, files) |
| Updates | Signed installer and auto-update, staged rollout, rollback |

**Why Electron:** mature ESC/POS printing, serial/USB access, auto-update and code signing, and the team's TypeScript/React skills carry over. Tauri was considered (smaller install) but moves hardware work into Rust.

## Process Boundary

- The **main process** owns the database, printing, cash drawer, licensing, backups and session checks.
- The **renderer** displays data and calls a narrow, typed IPC API through the preload script. It never touches the database, filesystem or hardware directly.
- Every IPC input is validated with Zod in main, and every data call requires a signed-in session checked in main — hiding a button in the UI is not a check.
- Electron hardening: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote content loaded into windows.

## Database

**Must store:**

- Store settings, users (hashed password and PIN)
- Products, barcodes, pack conversions, categories, suppliers
- Sales, sale lines, payments, returns, held bills
- Stock movements, stocktakes
- Purchase orders, goods receipts, purchase returns
- Shifts, cash movements
- Audit log, backup records

**Data rules:**

- **Money is stored as integer paisa.** Never floats.
- **Quantities are stored as integer milli-units** (3 decimals for weighed items).
- Sale lines store a **snapshot** of name, price, cost and tax rate at the time of sale. Reports must not change when the catalog does.
- **Stock on hand = sum of stock movements.** A cached per-product total is allowed but must be rebuildable from the ledger.
- Completed sales, payments, stock movements and audit entries are **append-only**. Corrections are new records (returns, adjustments), never edits.
- Times are stored in UTC and displayed in Asia/Karachi.
- Schema changes go through versioned migrations that run at startup, back up first, and never lose data.

**Things to think about:**

- What happens to an in-progress bill when power dies mid-payment? It must be either fully saved or fully restorable.
- How do you migrate the schema safely on hundreds of stores that update on different days?
- Tax-inclusive vs tax-exclusive pricing and exempt items — how is tax computed and rounded per line so totals always add up?
- Which indexes keep barcode lookup and product search under 100 ms at 30,000 products, and reports under 3 s at 500,000 sale lines?

## Phase-2 Readiness

v1 builds none of Phase 2 (`phase-2-multi-system.md`), but must not block it. These rules are cheap now and expensive to retrofit:

- Primary keys are **UUIDv7**, not autoincrement, so rows from different terminals never collide.
- Every transactional row carries `store_id` and `terminal_id` (one value each in v1).
- Invoice numbers are per-terminal sequences: `<terminal-code>-<seq>`.
- Every row has `created_at` and `updated_at`.
- Editable records (products, categories, suppliers, users, settings) are **soft-deleted**, never removed, so a delete can be synced later.
- All database writes go through one service layer in the main process.
- SQL stays portable — no SQLite-only features that would block a Postgres hub later.

## FBR-Readiness

FBR fiscal integration is deferred, but v1 keeps the data it will need so no migration of historical sales is required:

- Products have an optional PCT/HS code and a tax category.
- Sale lines snapshot the tax rate and the computed tax.
- Each terminal has its own invoice sequence (FBR requires one POS ID per counter).
- Returns reference the original sale and line when the return has a receipt.
- Products have a Third Schedule flag (`is_third_schedule`, default off). Sale lines snapshot it and the MRP, because Third Schedule items are taxed on the printed retail price.
- Each terminal has an optional FBR POS ID (`fbr_pos_id`).

## Hardware

| Device | v1 support |
|--------|-----------|
| Receipt printer | ESC/POS thermal, 58 and 80 mm: a Windows-installed printer sent raw through the spooler, or a network printer on TCP 9100 (Xprinter XP-58 and XP-80, Epson TM-T82, Black Copper BC-85) |
| Cash drawer | Kick through the receipt printer: `ESC p 0 25 250` (pin 2) |
| Barcode scanner | USB keyboard-wedge (no driver) |
| Label scale | EAN-13 scale barcodes (prefix-configurable) |
| Serial scale, customer display | Stretch |

The receipt is one dithered 1-bit raster image sent with `GS v 0` in bands of at most 128 rows, then a feed and `GS V 66 0` to cut. These are the only commands used, because all four target printers support them. The renderer never talks to the printer: main builds every job. `VENDORA_FAKE_PRINTER=<dir>` replaces the printer in unpackaged builds and writes each job as a `.bin` (exact bytes) and `.png`, and each drawer kick as a line in `drawer.log`.

## Performance Targets

| Metric | Target |
|--------|--------|
| Cold start to login screen | < 5 s on i3 / 4 GB RAM / HDD |
| Scan → line on screen | < 100 ms (p95) |
| Product search, 30,000 SKUs | < 100 ms |
| Payment → receipt starts printing | < 1.5 s |
| Any report, 1 year of data | < 3 s |
| Minimum screen | 1366×768 with no horizontal scroll |

## Security

- Passwords and PINs hashed with argon2id; PIN lockout after 5 failed attempts.
- License data stored encrypted at rest (Windows DPAPI).
- Every data IPC call requires a signed-in session, enforced in the main process.
- No telemetry containing business data. Crash reports are opt-in and scrub personal data.
- Open decision: whole-database encryption (SQLCipher). The store owner has physical access, so the value is mainly against PC theft.

## Accessibility

Meet WCAG 2.1 AA where it applies to a desktop app: contrast, visible focus, full keyboard operation, never colour alone for status, touch targets ≥ 44 px.

## Distribution

- Signed Windows installer; per-user data in the app data folder; backups to a user-chosen folder.
- Auto-update checks when online, never interrupts an open bill, and can roll back a failed update.
