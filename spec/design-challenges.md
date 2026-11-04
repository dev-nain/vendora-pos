# Design Challenges

These features need product decisions before they are built. The acceptance criteria in `core-requirements.md` set the floor; the questions below are for the developer and product owner to answer together.

For each, document the decisions and reasoning in the README.

---

## 1. Billing Screen Layout

**The problem:** The cashier lives on this screen for 10 hours a day, under time pressure, often with a queue. It must work by keyboard and scanner alone, on a 1366×768 screen, and on touch-screen counters.

**Design this:**

- Where do the bill lines, totals, product search, held bills and status (printer, shift, user) sit?
- Which actions get F-keys, and how are shortcuts shown so new cashiers learn them?
- How does a weighed item, a pack barcode, or an unknown barcode interrupt the flow — and get out of the way again?
- How big are the total and change-due numbers, so a customer can read them from a metre away?
- What does payment look like for a split cash + wallet payment?

**Questions to consider:**

- One screen for everything, or a separate payment step?
- How do you stop a mistyped quantity (e.g. 100 instead of 1) without slowing every sale?

---

## 2. Owner Dashboard

**The problem:** The owner opens Vendora for two minutes at the end of the day. What do they need to see to trust the numbers and spot a problem?

**Design this:**

- Which numbers lead: sales, profit, cash variance, low stock, unusual voids/overrides?
- How do you compare against yesterday or the same day last week?
- How does the owner get from a worrying number to the bills behind it?

**Questions to consider:**

- What counts as "unusual" activity worth flagging, without crying wolf?

---

## 3. First-Run Onboarding

**The problem:** Stores arrive with a catalog in Excel, in a notebook, or nowhere at all. The first sale should happen within two hours of install.

**Design this:**

- What's the minimum setup before the first sale is allowed?
- How does a store with no catalog file start — scan products as they sell, with a "name it now" prompt?
- How does the import template explain itself to someone who isn't technical?
- When and how do you push backup-folder setup without making it feel optional?

**Questions to consider:**

- Should Vendora ship a starter catalog of common Pakistani FMCG barcodes?
- How do you handle an import where half the rows have errors?
