import { describe, expect, it } from "vitest";
import { backspace, freshField, typeKey } from "./numpad-entry";

describe("typeKey", () => {
  it("replaces pre-selected text with the first key", () => {
    expect(typeKey(freshField("12"), "5", true)).toEqual({ text: "5", fresh: false });
  });

  it("appends to typed text", () => {
    expect(typeKey({ text: "1", fresh: false }, "2", true)).toEqual({ text: "12", fresh: false });
  });

  it("drops a leading zero", () => {
    expect(typeKey({ text: "0", fresh: false }, "7", true).text).toBe("7");
  });

  it("allows one decimal point and writes a leading zero", () => {
    expect(typeKey(freshField("3"), ".", true).text).toBe("0.");
    expect(typeKey({ text: "1.5", fresh: false }, ".", true).text).toBe("1.5");
  });

  it("ignores the decimal point where only whole numbers fit", () => {
    const state = { text: "4", fresh: false };
    expect(typeKey(state, ".", false)).toBe(state);
  });

  it("ignores keys that are not digits and caps the length", () => {
    const state = { text: "123456789012", fresh: false };
    expect(typeKey(state, "1", true)).toBe(state);
    expect(typeKey(state, "x", true)).toBe(state);
  });
});

describe("backspace", () => {
  it("clears pre-selected text first", () => {
    expect(backspace(freshField("1"), "qty")).toEqual({
      kind: "edit",
      state: { text: "", fresh: false },
    });
  });

  it("sets an empty quantity to zero, then removes the line", () => {
    const empty = { text: "", fresh: false };
    expect(backspace(empty, "qty")).toEqual({
      kind: "edit",
      state: { text: "0", fresh: false },
    });
    expect(backspace({ text: "0", fresh: false }, "qty")).toEqual({ kind: "delete-line" });
  });

  it("removes one character at a time", () => {
    expect(backspace({ text: "125", fresh: false }, "qty")).toEqual({
      kind: "edit",
      state: { text: "12", fresh: false },
    });
  });

  it("leaves empty price and discount fields empty and never deletes the line", () => {
    for (const mode of ["price", "discount"] as const) {
      expect(backspace({ text: "", fresh: false }, mode)).toEqual({
        kind: "edit",
        state: { text: "", fresh: false },
      });
      expect(backspace({ text: "0", fresh: false }, mode)).toEqual({
        kind: "edit",
        state: { text: "", fresh: false },
      });
    }
  });
});
