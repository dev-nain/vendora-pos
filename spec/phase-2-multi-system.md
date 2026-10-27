# Phase 2: Multi-System

Out of scope for v1. This file exists so v1 decisions don't block it. Do not build any of it until Phase 2 starts.

---

## Goals

- **Multiple counters in one store**, sharing one catalog, stock and reporting.
- **Multiple branches** with a central catalog, transfers between branches, and combined reports.
- **Owner remote view** — cloud dashboard or mobile app.

## Chosen Direction: Local Copy + Sync

Each terminal keeps its own SQLite database and syncs with a hub (a store PC, or the cloud for multiple branches). A counter keeps selling when the network or the hub is down — the same promise v1 makes.

A hub-only setup (terminals read and write a central database over the LAN) was rejected: if the hub PC or the LAN fails, every counter stops billing.

## How v1 Data Fits

| Data | Sync behaviour |
|------|---------------|
| Sales, payments, returns, stock movements, audit log | Append-only — merge every terminal's rows with no conflicts |
| Stock on hand | Sum of merged movements; negative stock already allowed |
| Products, prices, categories, suppliers, users, settings | Hub is the source of truth; pushed to terminals; last write wins |
| Shifts, cash movements, held bills | Belong to one terminal |
| Invoice numbers | Per-terminal sequences already |

## What Phase 2 Must Build

- Sync engine: change tracking, upload/download queues, retries, first-time setup of a new terminal
- Terminal registration and licensing per terminal
- Reports that combine terminals and branches
- Inter-branch stock transfers
- Conflict rule and UI for master data edited offline on two terminals

## Things to think about

- Build the sync engine, or use an existing SQLite sync library?
- Is the hub a store PC, the cloud, or both?
- How does a new terminal get its initial copy of a 30,000-product catalog?
