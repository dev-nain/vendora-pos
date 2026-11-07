import type { DocumentPanel } from "../../shared/document";
import type { ReceiptSettings } from "../../shared/settings";

export const present = (value: string | null): value is string =>
  value !== null && value.trim() !== "";

export function labelled(label: string, value: string | null): string[] {
  return present(value) ? [`${label}: ${value}`] : [];
}

export function buildStorePanel(store: ReceiptSettings): DocumentPanel {
  return {
    lines: [
      ...(present(store.name) ? [store.name] : []),
      ...(present(store.address) ? [store.address] : []),
      ...labelled("Phone", store.phone),
      ...labelled("NTN", store.ntn),
      ...labelled("STRN", store.strn),
    ],
  };
}
