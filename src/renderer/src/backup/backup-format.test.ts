import { describe, expect, it } from "vitest";
import { backupKindLabel, formatBackupSize } from "./backup-format";

describe("formatBackupSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [655_360, "640 KB"],
    [1_048_000, "1023 KB"],
    [1_048_576, "1.0 MB"],
    [13_002_342, "12.4 MB"],
    [3 * 1024 * 1024 * 1024, "3.0 GB"],
  ])("formats %d bytes as %s", (bytes, label) => {
    expect(formatBackupSize(bytes)).toBe(label);
  });
});

describe("backupKindLabel", () => {
  it("labels every kind", () => {
    expect(backupKindLabel("backup")).toBe("Backup");
    expect(backupKindLabel("before-restore")).toBe("Before restore");
    expect(backupKindLabel("before-update")).toBe("Before update");
  });
});
