import { describe, expect, it } from "vitest";
import { recoveryBackupStatuses } from "@shared/recovery";
import { damageMessage, recoveryStatusLabel, startupProblemCopy } from "./recovery-format";

describe("recoveryStatusLabel", () => {
  it("labels every status in plain words", () => {
    expect(recoveryBackupStatuses.map(recoveryStatusLabel)).toEqual([
      "Good",
      "Password-protected",
      "Damaged",
      "Not a Vendora backup",
      "From a newer version",
    ]);
  });
});

describe("startupProblemCopy", () => {
  it("explains a damaged file and says it was kept", () => {
    expect(startupProblemCopy({ mode: "damaged" })).toEqual(damageMessage());
    expect(damageMessage().body).toContain("kept it unchanged");
  });

  it.each([
    ["in-use", "Another program is using it"],
    ["access-denied", "Antivirus"],
    ["unreadable", "Restart the PC"],
  ] as const)("tells the user what to do when the file is %s", (failure, phrase) => {
    const copy = startupProblemCopy({ mode: "open-failed", failure });
    expect(copy.body).toContain(phrase);
    expect(copy.body).toContain("Retry");
    expect(copy.body).toContain("hasn't been changed");
  });

  it("says the data is from a newer version and unchanged", () => {
    const copy = startupProblemCopy({ mode: "newer-version" });
    expect(copy.title).toBe("This data is from a newer version of Vendora");
    expect(copy.body).toContain("hasn't been changed");
  });

  it("says the update failed and the data is still there", () => {
    expect(startupProblemCopy({ mode: "migration-failed" }).title).toBe(
      "Vendora couldn't update your data",
    );
  });
});
