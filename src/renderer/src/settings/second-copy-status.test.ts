import type { SecondCopyStatus } from "@shared/settings";
import { describe, expect, it } from "vitest";
import { secondCopyNotice, secondCopyRow } from "./second-copy-status";

const at = "2026-03-10T06:00:00.000Z";
const failed: SecondCopyStatus = {
  folder: "E:\\Backups",
  lastCopy: {
    result: "failed",
    at,
    reason: "Folder not found. If it's on a USB drive, plug it in.",
  },
};

describe("secondCopyNotice", () => {
  it("names the reason when the last copy failed", () => {
    expect(secondCopyNotice(failed)).toBe(
      "Second backup copy failed: Folder not found. If it's on a USB drive, plug it in. See Settings.",
    );
  });

  it("is null after a good copy", () => {
    expect(secondCopyNotice({ folder: "E:\\", lastCopy: { result: "ok", at } })).toBeNull();
  });

  it("is null when there is no copy yet", () => {
    expect(secondCopyNotice({ folder: "E:\\", lastCopy: null })).toBeNull();
  });

  it("is null once the folder is cleared", () => {
    expect(secondCopyNotice({ ...failed, folder: null })).toBeNull();
  });
});

describe("secondCopyRow", () => {
  it("shows nothing when no folder is set", () => {
    expect(secondCopyRow({ folder: null, lastCopy: null })).toEqual({ kind: "none" });
  });

  it("says no copy yet when a folder is set", () => {
    expect(secondCopyRow({ folder: "E:\\", lastCopy: null })).toEqual({
      kind: "waiting",
      text: "No copy yet. The next backup makes one.",
    });
  });

  it("shows the time of a good copy", () => {
    expect(secondCopyRow({ folder: "E:\\", lastCopy: { result: "ok", at } })).toEqual({
      kind: "ok",
      text: "Last copy 10 Mar 2026, 11:00 am",
    });
  });

  it("shows the reason and time of a failed copy", () => {
    expect(secondCopyRow(failed)).toEqual({
      kind: "failed",
      text: "Second copy failed: Folder not found. If it's on a USB drive, plug it in.",
      at: "10 Mar 2026, 11:00 am",
    });
  });
});
