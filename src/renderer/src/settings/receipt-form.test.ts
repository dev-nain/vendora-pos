import { describe, expect, it } from "vitest";
import { parseReceiptForm, receiptFormFrom, type ReceiptForm } from "./receipt-form";

const blank: ReceiptForm = {
  name: "",
  address: "",
  phone: "",
  ntn: "",
  strn: "",
  headerEn: "",
  headerUr: "",
  footerEn: "",
  footerUr: "",
};

describe("receiptFormFrom", () => {
  it("turns nulls into empty strings", () => {
    expect(
      receiptFormFrom({
        name: "Al Noor",
        address: null,
        phone: null,
        ntn: null,
        strn: null,
        headerEn: null,
        headerUr: "خوش آمدید",
        footerEn: null,
        footerUr: null,
      }),
    ).toEqual({ ...blank, name: "Al Noor", headerUr: "خوش آمدید" });
  });
});

describe("parseReceiptForm", () => {
  it("stores empty fields as null and trims the rest", () => {
    expect(parseReceiptForm({ ...blank, name: "  Al Noor ", ntn: "12345678" })).toEqual({
      ok: true,
      settings: {
        name: "Al Noor",
        address: null,
        phone: null,
        ntn: "1234567-8",
        strn: null,
        headerEn: null,
        headerUr: null,
        footerEn: null,
        footerUr: null,
      },
    });
  });

  it("returns an error per bad field", () => {
    const result = parseReceiptForm({
      ...blank,
      ntn: "123",
      strn: "12",
      phone: "abc",
      headerEn: "a\nb\nc\nd\ne",
      address: "x".repeat(201),
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        ntn: "NTN is 7 digits, then 1 digit, like 1234567-8.",
        strn: "STRN is 13 digits.",
        phone: "Phone has digits, spaces, + and - only.",
        headerEn: "Header is up to 4 lines.",
        address: "Address is up to 200 characters.",
      },
    });
  });

  it("accepts a 300 character footer and rejects 301", () => {
    expect(parseReceiptForm({ ...blank, footerUr: "x".repeat(300) }).ok).toBe(true);
    expect(parseReceiptForm({ ...blank, footerUr: "x".repeat(301) })).toMatchObject({
      ok: false,
      errors: { footerUr: "Footer is up to 300 characters." },
    });
  });
});
