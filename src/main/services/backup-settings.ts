import { desc, eq, isNotNull } from "drizzle-orm";
import type { SecondCopyStatus } from "../../shared/settings";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { backupRecords, terminals } from "../db/schema";
import { currentTerminal } from "../db/terminal";
import { getSecondCopyFolder } from "../settings/store-settings";
import type { createAuditService } from "./audit";

interface BackupSettingsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  chooseFolder: () => Promise<string | null>;
}

export function createBackupSettingsService({
  database,
  audit,
  sessions,
  chooseFolder,
}: BackupSettingsDeps) {
  const { db } = database;

  function status(): SecondCopyStatus {
    const folder = getSecondCopyFolder(db, currentTerminal(db).id);
    if (folder === null) return { folder, lastCopy: null };
    const row = db
      .select()
      .from(backupRecords)
      .where(isNotNull(backupRecords.copyResult))
      .orderBy(desc(backupRecords.createdAt))
      .limit(1)
      .get();
    if (!row) return { folder, lastCopy: null };
    const at = row.createdAt.toISOString();
    return {
      folder,
      lastCopy:
        row.copyResult === "ok"
          ? { result: "ok", at }
          : { result: "failed", at, reason: row.copyError ?? "Copy failed." },
    };
  }

  function save(to: string | null): SecondCopyStatus {
    const session = requireSession(sessions);
    db.transaction((tx) => {
      const terminal = currentTerminal(tx);
      const from = getSecondCopyFolder(tx, terminal.id);
      if (from === to) return;
      tx.update(terminals).set({ secondCopyFolder: to }).where(eq(terminals.id, terminal.id)).run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "terminal",
          entityId: terminal.id,
          details: { setting: "secondCopyFolder", from, to },
        },
        tx,
      );
    });
    return status();
  }

  function getSecondCopy(): SecondCopyStatus {
    requireSession(sessions);
    return status();
  }

  async function chooseSecondCopyFolder(): Promise<SecondCopyStatus> {
    requireSession(sessions);
    const folder = await chooseFolder();
    if (folder === null) return status();
    return save(folder);
  }

  function clearSecondCopyFolder(): SecondCopyStatus {
    return save(null);
  }

  return { getSecondCopy, chooseSecondCopyFolder, clearSecondCopyFolder };
}

export type BackupSettingsService = ReturnType<typeof createBackupSettingsService>;
