import { describe, expect, it } from "vitest";
import { emptyBuyerText, filledBuyerCount, parseBuyer } from "./buyer-input";

describe("parseBuyer", () => {
  it("returns no buyer when every field is empty", () => {
    expect(parseBuyer(emptyBuyerText())).toEqual({ ok: true, buyer: undefined });
    expect(parseBuyer({ ...emptyBuyerText(), name: "   " })).toEqual({
      ok: true,
      buyer: undefined,
    });
  });

  it("sends only the filled, trimmed fields", () => {
    expect(parseBuyer({ ...emptyBuyerText(), name: " Mr Khan ", ntn: "12345678" })).toEqual({
      ok: true,
      buyer: { name: "Mr Khan", ntn: "12345678" },
    });
  });

  it("reports an error per bad field", () => {
    const result = parseBuyer({ name: "", ntn: "12345", cnic: "1", phone: "03001234567" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).toSorted()).toEqual(["cnic", "ntn"]);
    expect(result.errors.ntn).toBe("NTN is 7 digits, then 1 digit, like 1234567-8.");
  });

  it("refuses a name over 100 characters", () => {
    const result = parseBuyer({ ...emptyBuyerText(), name: "a".repeat(101) });
    expect(result).toEqual({ ok: false, errors: { name: "Name is up to 100 characters." } });
  });

  it("counts filled fields", () => {
    expect(filledBuyerCount({ name: "A", ntn: " ", cnic: "", phone: "0300" })).toBe(2);
  });
});
