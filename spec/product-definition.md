# Product Definition: Vendora

## What

Vendora is a fast, offline-first desktop point-of-sale for general stores in Pakistan. One Windows PC at the counter runs billing, inventory, purchasing, shifts and reports against a local database, and keeps working when the internet or electricity drops.

v1 is **single-terminal**: one counter, one PC, one local database. Multi-terminal and multi-branch come in Phase 2 (`phase-2-multi-system.md`), and v1 is designed not to block it.

## Who

General stores (kiryana, mini-marts, small superstores) with 1,000–30,000 SKUs and 100–1,500 bills a day. Vendora is a product licensed to many independent stores, not a custom build for one shop.

**User profiles:**

- **The owner (malik)** who wants to know what sold, what is in stock, what profit was made, and whether cash matches — without sitting at the counter.
- **The cashier** who bills fast during rush hours, mostly by keyboard and scanner: loose items by weight, split cash/card, holds a bill while a customer fetches one more thing.
- **The manager / stock-keeper** who receives supplier deliveries, updates cost prices, counts stock, and checks the low-stock list before ordering.

**Typical setup:** Windows 10/11 PC (i3, 4–8 GB RAM, often HDD, 1366×768 screen), 80 mm or 58 mm thermal receipt printer, USB barcode scanner, cash drawer on the printer, UPS of variable quality, unreliable internet.

## Why

- **Paper and Excel don't scale.** Stock never matches reality, cost prices go stale, profit numbers are guesses, and cash shortages can't be traced to a shift.
- **Cloud-only POS is risky at the counter.** Load-shedding and flaky internet stop billing. A local database that never blocks a sale is a selling point.
- **Existing options are a poor fit.** Local products are either cloud-first SaaS or dated desktop software with slow, confusing billing. Global POS (Square, Loyverse) doesn't fit Pakistani pricing, units, or tax practice.

## Core Value Proposition

**"Bill fast, know your stock — even when the light goes."**

## Success Metrics (v1)

| Goal | Metric | Target |
|------|--------|--------|
| Fast checkout | Scan to line on screen | < 100 ms (p95) |
| | 10-item bill, first scan to printed receipt | < 30 s for a trained cashier |
| Zero data loss | Completed sales lost after a power cut | 0 |
| Quick onboarding | Install → first sale with catalog imported | < 2 hours |
| Trustworthy numbers | Stock variance per product at stocktake | Visible to the owner |

## Out of Scope (v1)

- **FBR fiscal integration** — deferred; v1 keeps the data it will need (see `technical-requirements.md`)
- **Customer credit (khata)** and loyalty — Stretch
- Multiple counters, LAN sync, multiple branches, cloud dashboard, owner mobile app — Phase 2
- Restaurant or pharmacy specifics (tables, kitchen tickets, prescriptions)
- E-commerce, delivery apps, full accounting (general ledger, payables), payroll
- Card terminal integration — card payments are recorded manually
