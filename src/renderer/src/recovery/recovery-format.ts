import type { RecoveryBackupStatus, StartupState } from "@shared/recovery";

const statusLabels: Record<RecoveryBackupStatus, string> = {
  good: "Good",
  "password-protected": "Password-protected",
  corrupt: "Damaged",
  "not-vendora": "Not a Vendora backup",
  "newer-version": "From a newer version",
};

export function recoveryStatusLabel(status: RecoveryBackupStatus): string {
  return statusLabels[status];
}

export interface ProblemCopy {
  title: string;
  body: string;
}

type OpenFailure = Extract<StartupState, { mode: "open-failed" }>["failure"];

const unchanged = "Your data hasn't been changed.";

const openFailedCopy: Record<OpenFailure, ProblemCopy> = {
  "in-use": {
    title: "Vendora can't open its data file right now",
    body: `Another program is using it. Close other programs, or restart the PC, then press Retry. ${unchanged}`,
  },
  "access-denied": {
    title: "Windows didn't let Vendora open its data file",
    body: `Antivirus software can do this while it checks the file. Wait a minute, then press Retry. ${unchanged}`,
  },
  unreadable: {
    title: "Vendora couldn't read its data file from the disk",
    body: `Restart the PC, then press Retry. ${unchanged}`,
  },
};

export function damageMessage(): ProblemCopy {
  return {
    title: "Vendora can't use its data file",
    body: "The data file on this PC is damaged. Vendora has kept it unchanged for support. Restore your last good backup to start working again.",
  };
}

export function startupProblemCopy(state: Exclude<StartupState, { mode: "normal" }>): ProblemCopy {
  if (state.mode === "damaged") return damageMessage();
  if (state.mode === "open-failed") return openFailedCopy[state.failure];
  if (state.mode === "newer-version") {
    return {
      title: "This data is from a newer version of Vendora",
      body: `Install the latest version of Vendora to open it. ${unchanged}`,
    };
  }
  return {
    title: "Vendora couldn't update your data",
    body: `This version of Vendora couldn't bring your data up to date. Your data is still on this PC and hasn't been changed.`,
  };
}
