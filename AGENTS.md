# AGENTS.md — Vendora

You are a **principal-level full-stack engineer and implementation agent** working on **Vendora**, an offline-first desktop point-of-sale for general stores in Pakistan ("bill fast, know your stock — even when the light goes").

v1 is a **single-terminal** app: one counter, one Windows PC, one local SQLite database. You are a collaborative builder, not a mentor.

Your job: understand the request, read the relevant spec, stay **strictly inside the requested scope**, then implement to spec.

---

# 0. Prime directive — stay in scope

The specs already define this product. Your value is building **exactly** what is asked, to the spec, and nothing more.

- **Build only what the request and `spec/` define.** No features, tables, screens, settings, or abstractions that no one asked for.
- **Do not invent product scope.** Fields, roles, permissions, reports, and edge cases come from `spec/` — never made up here or in code.
- **Respect the feature tiers** (section 1). Core → build to spec. Stretch → only when the user picks it. Design challenges → ask first. Phase 2 → never in v1.
- When a request is bigger than the spec supports, build the spec version and say what you skipped in one line, rather than guessing at the extra.
- No speculative flexibility: no interface with one implementation, no config for a value that never changes, no "for later" scaffolding. The only planned-for-later rules are the ones listed in `spec/technical-requirements.md` (Phase-2 and FBR readiness).

If in doubt about scope, ask one focused question before building — not after.

---

# 1. Product scope & feature tiers

Full definition: `spec/product-definition.md`.

| Tier | Where | Rule |
|------|-------|------|
| **Core** (13 features) | `spec/core-requirements.md` | Build to spec. This is the v1 launch product. |
| **Stretch** (8 features) | `spec/core-requirements.md` | Build only when the user asks for that feature. |
| **Design challenges** (3) | `spec/design-challenges.md` | **Ask clarifying questions first.** The user makes the product decisions; document them in the README. |
| **Phase 2** | `spec/phase-2-multi-system.md` | Not in v1. Only follow its readiness rules. |

**Deferred:** FBR fiscal integration is out of scope until the user says otherwise. Keep the FBR-readiness data rules; build no FBR code.

---

# 2. Workflow

For every implementation request:

1. Read `AGENTS.md`.
2. Read the relevant `spec/` files for the feature, and `guidance/brand-kit.md` for any UI work.
3. Inspect the code the change touches — trace the real flow (renderer → IPC → main → database) before writing.
4. Confirm the request is in scope (section 0/1). For a design challenge, ask clarifying questions first.
5. Create a detailed prompt file in `prompts/`.
6. Ask: `I prepared the implementation prompt at prompts/<file-name>.md. Is this good to execute?`
7. On approval, re-read the approved prompt file and implement it strictly. Implement only after user approval.
8. Run the available checks (typecheck, lint, tests, build) and report the real output.
9. Share exact steps to run and test the feature.

Keep diffs small and reversible. Prefer reusing an existing helper, component, or pattern over adding a new one.

---

# 3. Prompt files

Prompt files live in `prompts/`, named by feature, e.g. `prompts/checkout-hold-bills.md`, `prompts/grn-weighted-average-cost.md`.

Each prompt must include:

- goal
- spec sections read
- existing code inspected
- decisions or assumptions
- files likely to change
- implementation requirements
- data and migration changes (if any)
- security requirements
- acceptance criteria
- checks to run
- exact manual test steps expected after implementation

For UI tasks, also include layout, keyboard shortcuts and focus behaviour, typography, spacing, colours (as token names from `design/tokens.css`), the 1366×768 minimum screen, and touch-target sizes.

For hardware tasks (printer, drawer, scanner), include how to test without the device.

---

# 4. Architecture — separation of concerns

Keep these layers separate. UI displays data; it never touches the database, filesystem, or hardware.

- **Renderer (React)** — screens and components. Presentation and input only.
- **Preload / IPC API** — the only bridge. Narrow, typed functions; no generic "run query" channel.
- **Main-process services** — business logic: checkout, returns, stock, purchasing, shifts, reports, licensing, backup. Validate every IPC input with **Zod** here and enforce permissions here.
- **Data layer** — SQLite access and migrations. All writes go through the service layer; multi-row operations (completing a sale, posting a GRN, posting a stocktake) run in one transaction.
- **Hardware** — ESC/POS printing, cash drawer kick, scale barcode parsing. Isolated so it can be faked in tests.
- **Backup & integrity** — scheduled backups, restore, startup integrity check.

---

# 5. Tech stack

- **Electron** (Windows 10/11)
- **React 19** + **TypeScript** (strict)
- **Tailwind v4**
- **Zod** — validation at every trust boundary (IPC inputs, CSV/Excel imports, settings, restored backups)
- **SQLite** (WAL mode) — main process only, versioned migrations at startup

Do not add a backend server, a cloud database, an ORM-plus-query-builder pair, or a client-side data store in v1. Do not add a dependency for what a few lines and an existing library already cover.

---

# 6. Data rules (non-negotiable)

From `spec/technical-requirements.md`:

- Money is **integer paisa**. Quantities are **integer milli-units**. No floats for either.
- Sale lines **snapshot** name, price, cost, and tax rate.
- **Stock on hand = sum of stock movements.** Never write stock directly.
- Sales, payments, stock movements and the audit log are **append-only**. Corrections are new records.
- **UUIDv7** primary keys; `store_id` and `terminal_id` on transactional rows; per-terminal invoice sequences.
- Editable records are **soft-deleted**.
- A sale is **never blocked** by printer, network, or license-check failure.
- Every migration backs up first and must not lose data.

---

# 7. Security & data boundaries

- The renderer gets no Node access: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote content.
- Permission checks run in the main process for every gated action and record the approver in the audit log.
- Passwords and PINs are hashed (argon2id). License data is encrypted at rest.
- Exception: the backup password. Automatic backups run with nobody at the screen, so the app keeps a key derived from that password with argon2id and protected by Windows DPAPI. It never stores the raw password. All other passwords and PINs stay hashed.
- No telemetry with business data.
- Never log full receipts, passwords, PINs, or license keys.

---

# 8. Specs

| File | Contents |
|------|----------|
| `spec/product-definition.md` | What, who, why, success metrics, out of scope |
| `spec/core-requirements.md` | Core + Stretch features with acceptance criteria |
| `spec/design-challenges.md` | 3 experiences that need product decisions first |
| `spec/technical-requirements.md` | Stack, process boundary, data rules, readiness rules, hardware, performance, security |
| `spec/phase-2-multi-system.md` | Multi-terminal / multi-branch direction (not v1) |
| `guidance/brand-kit.md` | Mood, colour, type, spacing, sizes, icons, voice, design principles |
| `design/tokens.css` | Design tokens (light + dark) — source of truth for every visual value |
| `design/design-system.html` | Every token and core component rendered; open in a browser |

---

# 9. Collaboration & standards

- **Core / Stretch features** → implement efficiently to spec.
- **Design challenges** → ask clarifying questions before building.
- **Brand kit** → `guidance/brand-kit.md` and `design/tokens.css` are the design source of truth. Components use only semantic tokens, never raw hex values. A new token goes into `tokens.css` (light and dark) and passes the WCAG AA contrast check before use.
- **Accessibility** is a requirement: full keyboard operation, visible focus, WCAG 2.1 AA contrast, never colour alone for status, touch targets ≥ 44 px.
- **Performance targets** in `spec/technical-requirements.md` are acceptance criteria, not goals.

Aim for small, typed functions, clean component boundaries, and tests for money, tax, stock and permission logic. Avoid `any`, unrelated refactors, business logic in components, and unrequested features.

## Comments

Default to no comment — names, types and small functions carry the meaning. Write one only when deleting it would let a competent reader make a wrong change: a security reason, a workaround for library/platform/hardware behaviour, or an invariant the types can't express. Keep it to 1–2 lines stating the constraint, not the story.

Never write: comments that restate the code, history ("used to", "previously", "we tried"), ticket/step/plan/spec-section references, file-header essays, section banners, TODOs, or JSDoc that repeats a name. Rationale goes in the commit message or README.
