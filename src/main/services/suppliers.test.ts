import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateSupplierInput } from "../../shared/suppliers";
import { createSupplierInputSchema, updateSupplierInputSchema } from "../../shared/suppliers";
import { UnauthenticatedError } from "../auth/errors";
import { createSessionStore, type SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { auditLog, stores, suppliers, users } from "../db/schema";
import { seedStoreAndTerminal } from "../db/seed";
import { openMigratedDatabase } from "../db/test-database";
import { createAuditService } from "./audit";
import { createSuppliersService } from "./suppliers";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const input = (overrides: Partial<CreateSupplierInput> = {}) =>
  createSupplierInputSchema.parse({
    name: "Al-Noor",
    contactPerson: "Usman",
    phone: "0300-1234567",
    ntn: "1234567-8",
    notes: "Pays on Friday",
    ...overrides,
  });

const updateOf = (id: string, overrides: Partial<CreateSupplierInput> = {}) =>
  updateSupplierInputSchema.parse({
    id,
    name: "Al-Noor",
    contactPerson: "Usman",
    phone: "0300-1234567",
    ntn: "1234567-8",
    notes: "Pays on Friday",
    ...overrides,
  });

describe("createSuppliersService", () => {
  let dir: string;
  let database: VendoraDatabase;
  let sessions: SessionStore;
  let service: ReturnType<typeof createSuppliersService>;

  const storeId = () => database.db.select().from(stores).get()!.id;
  const auditRows = () => database.db.select().from(auditLog).all();
  const supplierRows = () => database.db.select().from(suppliers).all();
  const listActive = () => service.list({ includeArchived: false });
  const listAll = () => service.list({ includeArchived: true });

  const signIn = () => {
    const user = database.db
      .insert(users)
      .values({ username: "cashier", displayName: "Cashier", passwordHash: "p", pinHash: "q" })
      .returning()
      .get();
    sessions.start({ userId: user.id, storeId: storeId(), loggedInAt: new Date(0) });
    return user;
  };

  const created = (overrides: Partial<CreateSupplierInput> = {}) => {
    const result = service.create(input(overrides));
    if (!result.ok) throw new Error("create failed");
    return result.supplier;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-suppliers-service-"));
    database = openMigratedDatabase(join(dir, "vendora.db"));
    seedStoreAndTerminal(database);
    sessions = createSessionStore();
    service = createSuppliersService({ database, audit: createAuditService(database), sessions });
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses every method with no session and writes nothing", () => {
    const id = "01900000-0000-7000-8000-000000000001";

    expect(() => listActive()).toThrow(UnauthenticatedError);
    expect(() => service.create(input())).toThrow(UnauthenticatedError);
    expect(() => service.update(updateOf(id))).toThrow(UnauthenticatedError);
    expect(() => service.archive({ id })).toThrow(UnauthenticatedError);
    expect(() => service.restore({ id })).toThrow(UnauthenticatedError);

    expect(supplierRows()).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("creates a supplier with a UUIDv7 id, the store id and one audit row", () => {
    const user = signIn();

    const supplier = created();

    expect(supplier).toMatchObject({
      name: "Al-Noor",
      contactPerson: "Usman",
      phone: "0300-1234567",
      ntn: "1234567-8",
      notes: "Pays on Friday",
      isArchived: false,
    });
    const [row] = supplierRows();
    expect(row!.id).toMatch(uuidV7);
    expect(row!.storeId).toBe(storeId());
    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "settings_change",
      actorUserId: user.id,
      entityType: "supplier",
      entityId: row!.id,
    });
  });

  it("allows duplicate names", () => {
    signIn();
    created();
    created();
    expect(supplierRows()).toHaveLength(2);
  });

  it("updates fields and audits field names without their values", () => {
    signIn();
    const { id } = created();

    const result = service.update(updateOf(id, { phone: "0311-9999999", notes: "Secret note" }));

    expect(result).toMatchObject({ ok: true, supplier: { phone: "0311-9999999" } });
    const audit = auditRows().at(-1)!;
    expect(JSON.parse(audit.details!)).toEqual({ change: "update", fields: ["phone", "notes"] });
    expect(audit.details).not.toContain("0311");
    expect(audit.details).not.toContain("Secret");
  });

  it("writes no audit row for a no-op update", () => {
    signIn();
    const { id } = created();

    expect(service.update(updateOf(id))).toMatchObject({ ok: true });

    expect(auditRows()).toHaveLength(1);
  });

  it("returns not-found for an unknown id or another store's supplier", () => {
    signIn();
    const other = database.db.insert(stores).values({ name: "Other" }).returning().get();
    const foreign = database.db
      .insert(suppliers)
      .values({ storeId: other.id, name: "Foreign" })
      .returning()
      .get();

    for (const id of ["01900000-0000-7000-8000-000000000001", foreign.id]) {
      expect(service.update(updateOf(id))).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.archive({ id })).toMatchObject({ ok: false, reason: "not-found" });
      expect(service.restore({ id })).toMatchObject({ ok: false, reason: "not-found" });
    }
  });

  it("updates an archived supplier", () => {
    signIn();
    const { id } = created();
    service.archive({ id });

    const result = service.update(updateOf(id, { name: "Renamed" }));

    expect(result).toMatchObject({ ok: true, supplier: { name: "Renamed", isArchived: true } });
  });

  it("archives by setting deleted_at, keeping the row, and audits supplier_archive", () => {
    signIn();
    const { id } = created();

    const result = service.archive({ id });

    expect(result).toMatchObject({ ok: true, supplier: { isArchived: true } });
    const row = database.db.select().from(suppliers).where(eq(suppliers.id, id)).get()!;
    expect(row.deletedAt).not.toBeNull();
    expect(row).toMatchObject({ name: "Al-Noor", phone: "0300-1234567", notes: "Pays on Friday" });
    expect(auditRows().at(-1)).toMatchObject({ action: "supplier_archive", entityId: id });
  });

  it("restores by clearing deleted_at and audits supplier_restore", () => {
    signIn();
    const { id } = created();
    service.archive({ id });

    const result = service.restore({ id });

    expect(result).toMatchObject({ ok: true, supplier: { isArchived: false } });
    expect(supplierRows()[0]!.deletedAt).toBeNull();
    expect(auditRows().at(-1)).toMatchObject({ action: "supplier_restore", entityId: id });
  });

  it("writes no audit row for a repeat archive or restore", () => {
    signIn();
    const { id } = created();

    service.restore({ id });
    expect(auditRows()).toHaveLength(1);

    service.archive({ id });
    service.archive({ id });
    expect(auditRows()).toHaveLength(2);
  });

  it("hides archived suppliers from list() and shows them when asked", () => {
    signIn();
    const keep = created({ name: "Keep" });
    const gone = created({ name: "Gone" });
    service.archive({ id: gone.id });

    expect(listActive().map((s) => s.id)).toEqual([keep.id]);
    expect(service.list({ includeArchived: false }).map((s) => s.id)).toEqual([keep.id]);
    expect(listAll().map((s) => [s.name, s.isArchived])).toEqual([
      ["Gone", true],
      ["Keep", false],
    ]);
  });

  it("orders by name ignoring case", () => {
    signIn();
    created({ name: "banana" });
    created({ name: "Apple" });
    created({ name: "cherry" });

    expect(listActive().map((s) => s.name)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("does not list another store's suppliers", () => {
    signIn();
    const other = database.db.insert(stores).values({ name: "Other" }).returning().get();
    database.db.insert(suppliers).values({ storeId: other.id, name: "Foreign" }).run();
    created({ name: "Mine" });

    expect(listAll().map((s) => s.name)).toEqual(["Mine"]);
  });

  it("rolls back the change when the audit write fails", () => {
    signIn();
    const failing = createSuppliersService({
      database,
      sessions,
      audit: {
        record: () => {
          throw new Error("audit down");
        },
      },
    });

    expect(() => failing.create(input())).toThrow("audit down");
    expect(supplierRows()).toHaveLength(0);

    const { id } = created();
    const before = auditRows().length;
    expect(() => failing.archive({ id })).toThrow("audit down");
    expect(supplierRows()[0]!.deletedAt).toBeNull();
    expect(auditRows()).toHaveLength(before);
  });
});
