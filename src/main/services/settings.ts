import { eq } from "drizzle-orm";
import type {
  AutoLockInput,
  AutoLockSetting,
  MiscItemInput,
  MiscItemSetting,
  ScalePrefixesInput,
  ScalePrefixesSetting,
} from "../../shared/settings";
import { requireSessionPermission } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { stores } from "../db/schema";
import {
  getAutoLockMinutes,
  getMiscItemEnabled,
  getScalePrefixes,
} from "../settings/store-settings";
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

  function setScalePrefixes(input: ScalePrefixesInput): ScalePrefixesSetting {
    const session = requireSessionPermission(sessions, "settings.manage");
    db.transaction((tx) => {
      const from = getScalePrefixes(database, session.storeId);
      if (from.weightPrefix === input.weightPrefix && from.pricePrefix === input.pricePrefix) {
        return;
      }
      tx.update(stores)
        .set({ scaleWeightPrefix: input.weightPrefix, scalePricePrefix: input.pricePrefix })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "scalePrefixes", from: { ...from }, to: { ...input } },
        },
        tx,
      );
    });
    return { weightPrefix: input.weightPrefix, pricePrefix: input.pricePrefix };
  }

  function getMiscItemSetting(): MiscItemSetting {
    const session = requireSessionPermission(sessions, "settings.manage");
    return { enabled: getMiscItemEnabled(database, session.storeId) };
  }

  function setMiscItemEnabled(input: MiscItemInput): MiscItemSetting {
    const session = requireSessionPermission(sessions, "settings.manage");
    db.transaction((tx) => {
      const from = getMiscItemEnabled(database, session.storeId);
      if (from === input.enabled) return;
      tx.update(stores)
        .set({ miscItemEnabled: input.enabled })
        .where(eq(stores.id, session.storeId))
        .run();
      audit.record(
        {
          action: "settings_change",
          actorUserId: session.userId,
          entityType: "store",
          entityId: session.storeId,
          details: { setting: "miscItemEnabled", from, to: input.enabled },
        },
        tx,
      );
    });
    return { enabled: input.enabled };
  }

  return {
    getAutoLock,
    setAutoLock,
    setScalePrefixes,
    getMiscItemEnabled: getMiscItemSetting,
    setMiscItemEnabled,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
