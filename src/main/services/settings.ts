import { eq } from "drizzle-orm";
import type { AutoLockInput, AutoLockSetting } from "../../shared/settings";
import { requireSessionPermission } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { stores } from "../db/schema";
import { getAutoLockMinutes } from "../settings/store-settings";
import type { createAuditService } from "./audit";

interface SettingsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  onAutoLockChanged: () => void;
}

export function createSettingsService({
  database,
  audit,
  sessions,
  onAutoLockChanged,
}: SettingsDeps) {
  const { db } = database;

  function getAutoLock(): AutoLockSetting {
    const session = requireSessionPermission(sessions, "settings.manage");
    return { minutes: getAutoLockMinutes(database, session.storeId) };
  }

  function setAutoLock(input: AutoLockInput): AutoLockSetting {
    const session = requireSessionPermission(sessions, "settings.manage");
    const changed = db.transaction((tx) => {
      const from = getAutoLockMinutes(database, session.storeId);
      if (from === input.minutes) return false;
      tx.update(stores)
        .set({ autoLockMinutes: input.minutes })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "autoLockMinutes", from, to: input.minutes },
        },
        tx,
      );
      return true;
    });
    if (changed) onAutoLockChanged();
    return { minutes: input.minutes };
  }

  return { getAutoLock, setAutoLock };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
