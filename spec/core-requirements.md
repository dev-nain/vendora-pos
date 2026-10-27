# Core Requirements

Features are organized into two tiers. **Core** is the v1 launch product. **Stretch** comes after Core is stable, one feature at a time when picked. Product decisions for three experiences are left open — see `design-challenges.md`. Multi-system work is in `phase-2-multi-system.md`.

---

# Core

These 13 features form a complete single-terminal POS.

---

## 1. Store Setup & Onboarding

A new store goes from install to first sale without outside help.

**Acceptance criteria:**

- First-run wizard: store name, address, phone, NTN/STRN (optional), receipt header and footer (English and Urdu), logo
- Create the Owner account (username + password, plus a 4–6 digit PIN for quick login)
- Tax defaults: standard sales tax rate (configurable), and whether prices are tax-inclusive or tax-exclusive (store-wide)
- Hardware setup: choose receipt printer, paper width (58/80 mm), test print, cash drawer kick test, scanner test field
- Catalog import from a CSV/Excel template (name, barcode, category, unit, cost, sale price, MRP, tax category, opening stock)
- Import shows a preview and a per-row error report; a fatal error imports nothing
- Wizard can be skipped and resumed later from settings

---

## 2. Licensing & Activation

Vendora is sold per store; a license must not get in the way of billing.

**Acceptance criteria:**

- Activate with a license key; the license is bound to the machine
- Works fully offline after activation; re-validates when online, with a 30-day offline grace period
- Expired or invalid license puts the app in **read-only** mode: reports, export and backup still work; no data is deleted or hidden
- License can be moved to a new PC (old one deactivated) through a support flow

---

## 3. Users, Roles & Permissions

Staff log in fast, and sensitive actions always record who approved them.

**Acceptance criteria:**

- Three fixed roles: **Owner**, **Manager**, **Cashier**
- Login by username + password; quick switch by PIN at the counter; auto-lock after a configurable idle time
- Gated actions ask for a Manager/Owner PIN inline instead of forcing a logout: discount above the cashier limit, price override, void a completed sale, return without receipt, open drawer without a sale, stock adjustment, cost-price change, delete product
- Every override records the approver
- PIN locks after 5 failed attempts

| Action | Cashier | Manager | Owner |
|--------|:-:|:-:|:-:|
| Sell, hold/resume, reprint | ✓ | ✓ | ✓ |
| Discount within limit (default 5%) | ✓ | ✓ | ✓ |
| Return with receipt | ✓ | ✓ | ✓ |
| Gated actions above | PIN | ✓ | ✓ |
| Products, purchasing, stock | – | ✓ | ✓ |
| Reports | own shift | ✓ | ✓ |
| Users, settings, license, backup restore | – | – | ✓ |

---

## 4. Product Catalog

Products match how a general store actually sells: by piece, by weight, by pack.

**Acceptance criteria:**

- Product fields: name (English, optional Urdu), category, brand, unit, one or more barcodes, internal code, cost price, sale price, MRP, tax category, PCT/HS code (optional), low-stock threshold, active flag
- Sell units: piece, weight (kg/g), volume (L/ml); weighed quantities support 3 decimals
- Pack conversions: a pack barcode (e.g. "carton = 24 pcs") sells or receives the pack and moves stock in base units
- Scale barcodes: EAN-13 with embedded weight or price, using a configurable prefix
- Open-price "misc item" for uncatalogued goods (enabled by a setting)
- Search by name (English or Urdu, partial match), barcode, or code in under 100 ms on 30,000 products
- Bulk edit price and category; export the catalog to CSV
- Products with sales history are archived, never hard-deleted

---

## 5. Checkout (Billing)

The billing screen is where Vendora wins or loses. It must be fast, keyboard-first, and never lose a sale.

**Acceptance criteria:**

- Scanner input always lands in the current bill; focus returns to the scan field after every action
- Every main action (search, quantity, discount, hold, pay, return) has a keyboard shortcut; mouse and touch also work
- Scanning adds a line or increments its quantity; quantity is editable; weighed items take weight from a scale barcode or prompt for it
- Line discount and bill discount (amount or %), capped by the role's limit
- **Hold / resume** multiple bills; held bills survive an app restart
- Payment methods: cash, card (manual record + reference), bank transfer / mobile wallet (JazzCash, Easypaisa — manual reference), and **split** across methods
- Cash payment shows change due; quick-tender buttons (exact, 500, 1000, 5000)
- Totals show subtotal, discount, sales tax, rounding (configurable, shown as its own line) and grand total
- Completing a sale is **atomic**: sale, lines, payments and stock movements are all saved or none are
- Cash drawer opens on cash payment; the receipt prints automatically (setting: print / ask / don't print)
- A printer or network failure never blocks a sale — it degrades with a visible warning

---

## 6. Receipts & Printing

**Acceptance criteria:**

- Supports 58 mm and 80 mm ESC/POS thermal printers
- Receipt shows: store header, NTN/STRN if set, invoice number, date/time, cashier, lines (name, qty × price, discount, tax), totals, payments, change, receipt barcode (for returns), footer
- Urdu text prints correctly (rendered as an image, since printer fonts lack Urdu)
- Any past receipt can be reprinted, marked **"DUPLICATE"**
- Optional A4 invoice PDF per sale for business customers

---

## 7. Returns, Exchanges & Voids

**Acceptance criteria:**

- Void a line or cancel the bill **before payment** without approval (audit-logged)
- **Return after sale:** find the sale by scanning the receipt barcode, typing the invoice number, or searching by date
- Select lines and partial quantities; can't return more than was sold (including earlier returns)
- Refund to the original method or cash; **exchange** = return + new sale in one flow
- Each returned line goes back to sellable stock or to "damaged" (not sellable)
- Return without a receipt needs a Manager PIN and uses the current price
- A credit note receipt prints for every return

---

## 8. Inventory & Stock Alerts

**Acceptance criteria:**

- Stock on hand per product, derived from an append-only **stock movement ledger** (sale, return, receipt, adjustment, stocktake, damage)
- Stock adjustments require a reason (damage, expiry, theft, correction); Manager or Owner only
- **Stocktake:** start a count (full or by category), enter counted quantities with the scanner, review variance and its value, post all adjustments in one step
- Low-stock threshold per product, a **low-stock list**, and a badge on the dashboard
- Negative stock is allowed (a sale is never blocked) and listed in a negative-stock report
- Stock valued at weighted average cost

---

## 9. Purchasing & Suppliers

**Acceptance criteria:**

- Supplier records: name, contact person, phone, NTN, notes
- **Purchase order** (optional): build from the low-stock list or manually; print or save as PDF
- **Goods received note (GRN):** receive against a PO (partial deliveries allowed) or directly; enter quantity, cost price and the supplier's invoice number; scanner-friendly
- Receiving updates stock and the product's **weighted average cost**
- Prompt to update the sale price when margin falls below a configurable threshold
- Purchase return to supplier (stock out, linked to the supplier)
- Purchase history per supplier and per product (last cost, last supplier)

---

## 10. Shifts & Cash Management

**Acceptance criteria:**

- Cashier **opens a shift** with an opening float; sales require an open shift
- Cash in / cash out (e.g. petty expenses) with a reason
- **Close shift** with a **blind cash count** — the cashier enters counted cash by denomination before seeing the expected amount — then shows the variance
- X-report (mid-shift) and Z-report (at close): sales by payment method, returns, discounts, voids, overrides, cash movements, variance; printable on the receipt printer
- Day close summarizes all shifts of the day

---

## 11. Reports & Dashboard

**Acceptance criteria:**

- Dashboard: today's sales, bill count, average bill, gross profit, low-stock count
- Reports with date range, exportable to CSV and PDF:
  - Sales by day/hour, product, category, cashier, payment method
  - Gross profit and margin by product and category (cost at time of sale)
  - Discounts, returns, voids and overrides
  - Sales tax summary (taxable value and tax by rate)
  - Stock on hand and valuation, low stock, negative stock, movement history per product
  - Purchases by supplier, stocktake variance
- Any report over one year of data (≈ 500,000 sale lines) renders in under 3 seconds

---

## 12. Backup, Restore & Data Safety

The database lives on one PC. Losing it means losing the business's records.

**Acceptance criteria:**

- Automatic backup daily and at every shift close, kept 30 days
- Second copy to a user-chosen folder (USB drive or a synced folder such as Google Drive); onboarding asks for it
- Manual "Backup now"; **Restore** is Owner-only, checks integrity, and takes a backup of the current data first
- Writes survive a power cut; the app checks database integrity at startup and tells the user exactly what to do if something is wrong
- Optional password-protected backups

---

## 13. Audit Log

**Acceptance criteria:**

- Append-only log of: login/logout, overrides (with approver), voids, returns, price and cost changes, stock adjustments, drawer opens without a sale, settings changes, backup/restore
- Owner can filter by user, action and date
- Entries can't be edited or deleted from the app

---

# Stretch

Build only when the user picks the feature.

---

## 14. Customer Credit (Khata)

- Customer accounts with phone and credit limit
- Credit sale (full or partial) against a customer; payments received; running balance
- Customer statement (print/PDF); overdue list
- Reminder message text ready to send by WhatsApp/SMS

## 15. Batch & Expiry Tracking

- Expiry date (and optional batch) captured on GRN
- Near-expiry report (configurable days ahead); expired stock written off as damage
- Sell earliest-expiry first hint on stocktake and receiving

## 16. Promotions

- Buy X get Y, bundle price, quantity break, time-bound discounts
- Promotions show as their own line on the bill and receipt

## 17. Barcode & Shelf Labels

- Print barcode labels for products without one (internal EAN-13 range)
- Shelf price labels, single or bulk by category

## 18. Weighing Scale Integration

- Read live weight from a serial/USB scale into the quantity field

## 19. Customer-Facing Display

- Second screen showing current lines, total and change due

## 20. Urdu Interface

- Full Urdu, right-to-left UI with a language switch (receipts already support Urdu in Core)

## 21. Encrypted Cloud Backup

- Off-site encrypted backup with restore to a new PC
