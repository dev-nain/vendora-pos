import { describe, expect, it } from "vitest";

import {
  buildSupplierPayload,
  emptySupplierForm,
  formFromSupplier,
  isSupplierFormDirty,
} from "./supplier-form";

const supplier = {
  id: "01900000-0000-7000-8000-000000000001",
  name: "Al-Noor",
  contactPerson: null,
  phone: "0300-1234567",
  ntn: null,
  notes: null,
  isArchived: false,
};

describe("supplier form", () => {
  it("starts empty", () => {
    expect(emptySupplierForm()).toEqual({
      name: "",
      contactPerson: "",
      phone: "",
      ntn: "",
      notes: "",
    });
  });

  it("turns null fields into empty strings", () => {
    expect(formFromSupplier(supplier)).toEqual({
      name: "Al-Noor",
      contactPerson: "",
      phone: "0300-1234567",
      ntn: "",
      notes: "",
    });
  });

  it("detects changes", () => {
    const initial = formFromSupplier(supplier);
    expect(isSupplierFormDirty(initial, { ...initial })).toBe(false);
    expect(isSupplierFormDirty(initial, { ...initial, notes: "x" })).toBe(true);
  });

  it("returns the raw values as the payload when valid", () => {
    const values = { ...emptySupplierForm(), name: " Al-Noor ", ntn: "12345678" };
    expect(buildSupplierPayload(values)).toEqual({ ok: true, payload: values });
  });

  it("reports per-field errors", () => {
    const built = buildSupplierPayload({
      ...emptySupplierForm(),
      phone: "abc",
      ntn: "123",
      notes: "x".repeat(501),
    });
    expect(built).toEqual({
      ok: false,
      errors: {
        name: "Enter a name",
        phone: "Phone has digits, spaces, + and - only.",
        ntn: expect.any(String),
        notes: "Notes are up to 500 characters.",
      },
    });
  });
});
