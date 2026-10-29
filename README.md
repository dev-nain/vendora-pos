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

## Not included yet

Code signing, auto-update, and product tables. Each arrives with its own change.
