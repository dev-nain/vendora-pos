import { describe, expect, it } from "vitest";
import {
  createSupplierInputSchema,
  supplierIdInputSchema,
  supplierListInputSchema,
  updateSupplierInputSchema,
} from "./suppliers";

const blank = { contactPerson: null, phone: null, ntn: null, notes: null };
const uuid = "01900000-0000-7000-8000-000000000001";

describe("supplier schemas", () => {
  it("trims the name", () => {
    expect(createSupplierInputSchema.parse({ name: "  Al-Noor ", ...blank }).name).toBe("Al-Noor");
  });

  it.each(["", "   ", "x".repeat(101)])("rejects the name %j", (name) => {
    expect(createSupplierInputSchema.safeParse({ name, ...blank }).success).toBe(false);
  });

  it("turns blank optional fields into null", () => {
    expect(
      createSupplierInputSchema.parse({
        name: "A",
        contactPerson: "  ",
        phone: "",
        ntn: " ",
        notes: "\n",
      }),
    ).toEqual({ name: "A", ...blank });
  });

  it("normalises the NTN and rejects a bad NTN or phone", () => {
    expect(createSupplierInputSchema.parse({ name: "A", ...blank, ntn: "12345678" }).ntn).toBe(
      "1234567-8",
    );
    expect(createSupplierInputSchema.safeParse({ name: "A", ...blank, ntn: "123" }).success).toBe(
      false,
    );
    expect(createSupplierInputSchema.safeParse({ name: "A", ...blank, phone: "abc" }).success).toBe(
      false,
    );
  });

  it("rejects long contact person and notes", () => {
    expect(
      createSupplierInputSchema.safeParse({ name: "A", ...blank, contactPerson: "x".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      createSupplierInputSchema.safeParse({ name: "A", ...blank, notes: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(createSupplierInputSchema.safeParse({ name: "A", ...blank, extra: 1 }).success).toBe(
      false,
    );
  });

  it("rejects non-uuid ids", () => {
    expect(updateSupplierInputSchema.safeParse({ id: "1", name: "A", ...blank }).success).toBe(
      false,
    );
    expect(updateSupplierInputSchema.safeParse({ id: uuid, name: "A", ...blank }).success).toBe(
      true,
    );
    expect(supplierIdInputSchema.safeParse({ id: "1" }).success).toBe(false);
  });

  it("defaults includeArchived to false", () => {
    expect(supplierListInputSchema.parse({})).toEqual({ includeArchived: false });
  });
});
