import { eq } from "drizzle-orm";
import type {
  MiscItemInput,
  MiscItemSetting,
  ScalePrefixesInput,
  ScalePrefixesSetting,
} from "../../shared/settings";
import { requireSessionPermission } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { VendoraDatabase } from "../db/client";
import { stores } from "../db/schema";
import { getMiscItemEnabled, getScalePrefixes } from "../settings/store-settings";
import type { createAuditService } from "./audit";

interface SettingsDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
}

export function createSettingsService({ database, audit, sessions }: SettingsDeps) {
  const { db } = database;

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
    setScalePrefixes,
    getMiscItemEnabled: getMiscItemSetting,
    setMiscItemEnabled,
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
