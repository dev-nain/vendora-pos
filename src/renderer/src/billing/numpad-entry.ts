export type NumpadMode = "qty" | "discount" | "price";

export interface FieldState {
  text: string;
  fresh: boolean;
}

export type BackspaceOutcome = { kind: "edit"; state: FieldState } | { kind: "delete-line" };

const maxLength = 12;

export const freshField = (text: string): FieldState => ({ text, fresh: true });

export function typeKey(state: FieldState, key: string, allowDecimal: boolean): FieldState {
  const base = state.fresh ? "" : state.text;
  if (key === ".") {
    if (!allowDecimal || base.includes(".")) return state;
    return { text: base === "" ? "0." : `${base}.`, fresh: false };
  }
  if (!/^\d$/.test(key) || base.length >= maxLength) return state;
  return { text: base === "0" ? key : `${base}${key}`, fresh: false };
}

export function backspace(state: FieldState, mode: NumpadMode): BackspaceOutcome {
  if (state.fresh) return { kind: "edit", state: { text: "", fresh: false } };
  if (mode === "qty") {
    if (state.text === "") return { kind: "edit", state: { text: "0", fresh: false } };
    if (state.text === "0") return { kind: "delete-line" };
  }
  return { kind: "edit", state: { text: state.text.slice(0, -1), fresh: false } };
}
