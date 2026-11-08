import type {
  BackupPasswordResult,
  BackupPasswordStatus,
  ChangeBackupPasswordInput,
  TurnOffBackupPasswordInput,
  TurnOnBackupPasswordInput,
} from "../../shared/backup";
import { requireSession } from "../auth/guard";
import type { SessionStore } from "../auth/session";
import type { BackupKeyRecord, BackupKeyStore } from "../backup/backup-key";
import type { VendoraDatabase } from "../db/client";
import { currentTerminal } from "../db/terminal";
import type { createAuditService } from "./audit";

interface BackupPasswordDeps {
  database: VendoraDatabase;
  audit: ReturnType<typeof createAuditService>;
  sessions: SessionStore;
  keys: BackupKeyStore;
}

type Refusal = Extract<BackupPasswordResult, { ok: false }>;
type Change = "turned_on" | "changed" | "turned_off";

const messages: Record<Refusal["reason"], string> = {
  "wrong-password": "That password is wrong. Nothing was changed.",
  "protection-unavailable":
    "Windows can't protect the password on this PC, so it wasn't set. Nothing was changed.",
  "already-on": "The backup password is already on.",
  "already-off": "The backup password is already off.",
};

function refuse(reason: Refusal["reason"]): Refusal {
  return { ok: false, reason, message: messages[reason] };
}

export function createBackupPasswordService({
  database,
  audit,
  sessions,
  keys,
}: BackupPasswordDeps) {
  const { db } = database;

  async function status(): Promise<BackupPasswordStatus> {
    return { state: await keys.state() };
  }

  async function succeeded(): Promise<BackupPasswordResult> {
    return { ok: true, status: await status() };
  }

  function commit(
    userId: string,
    kind: Change,
    guard: () => Refusal | null,
    record: BackupKeyRecord | null,
  ): Refusal | null {
    return db.transaction((tx) => {
      const refusal = guard();
      if (refusal) return refusal;
      const terminal = currentTerminal(tx);
      audit.record(
        {
          action: "settings_change",
          actorUserId: userId,
          entityType: "terminal",
          entityId: terminal.id,
          details: { setting: "backupPassword", change: kind },
        },
        tx,
      );
      if (record) keys.write(record);
      else keys.remove();
      return null;
    });
  }

  async function getStatus(): Promise<BackupPasswordStatus> {
    requireSession(sessions);
    return status();
  }

  async function turnOn({ password }: TurnOnBackupPasswordInput): Promise<BackupPasswordResult> {
    const session = requireSession(sessions);
    if (keys.read().kind !== "off") return refuse("already-on");
    if (!(await keys.available())) return refuse("protection-unavailable");
    const record = await keys.prepare(password);
    const refusal = commit(
      session.userId,
      "turned_on",
      () => (keys.read().kind === "off" ? null : refuse("already-on")),
      record,
    );
    return refusal ?? succeeded();
  }

  async function verifyCurrent(current: string): Promise<Refusal | string> {
    const existing = keys.read();
    if (existing.kind === "off") return refuse("already-off");
    if (existing.kind === "damaged" || !(await keys.matches(current))) {
      return refuse("wrong-password");
    }
    return existing.record.check;
  }

  function unchangedSince(check: string): () => Refusal | null {
    return () => {
      const now = keys.read();
      if (now.kind === "off") return refuse("already-off");
      return now.kind === "set" && now.record.check === check ? null : refuse("wrong-password");
    };
  }

  async function change({
    current,
    next,
  }: ChangeBackupPasswordInput): Promise<BackupPasswordResult> {
    const session = requireSession(sessions);
    const verified = await verifyCurrent(current);
    if (typeof verified !== "string") return verified;
    if (!(await keys.available())) return refuse("protection-unavailable");
    const record = await keys.prepare(next);
    const refusal = commit(session.userId, "changed", unchangedSince(verified), record);
    return refusal ?? succeeded();
  }

  async function turnOff({ current }: TurnOffBackupPasswordInput): Promise<BackupPasswordResult> {
    const session = requireSession(sessions);
    const verified = await verifyCurrent(current);
    if (typeof verified !== "string") return verified;
    const refusal = commit(session.userId, "turned_off", unchangedSince(verified), null);
    return refusal ?? succeeded();
  }

  return { status: getStatus, turnOn, change, turnOff };
}

export type BackupPasswordService = ReturnType<typeof createBackupPasswordService>;
