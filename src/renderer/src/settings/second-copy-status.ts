import type { SecondCopyStatus } from "@shared/settings";
import { formatDateTime } from "../lib/date-time";

export type SecondCopyRow =
  | { kind: "none" }
  | { kind: "waiting"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "failed"; text: string; at: string };

export function secondCopyNotice(status: SecondCopyStatus): string | null {
  const { lastCopy } = status;
  if (status.folder === null || lastCopy?.result !== "failed") return null;
  return `Second backup copy failed: ${lastCopy.reason} See Settings.`;
}

export function secondCopyRow(status: SecondCopyStatus): SecondCopyRow {
  const { folder, lastCopy } = status;
  if (folder === null) return { kind: "none" };
  if (lastCopy === null) {
    return { kind: "waiting", text: "No copy yet. The next backup makes one." };
  }
  if (lastCopy.result === "ok") {
    return { kind: "ok", text: `Last copy ${formatDateTime(lastCopy.at)}` };
  }
  return {
    kind: "failed",
    text: `Second copy failed: ${lastCopy.reason}`,
    at: formatDateTime(lastCopy.at),
  };
}
