import { CircleCheckIcon, CircleXIcon, LockIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RestoreRefusal } from "@shared/backup";
import type { RecoveryBackup, RecoveryScan } from "@shared/recovery";
import { supportContact } from "@shared/support";
import { Button } from "@renderer/components/ui/button";
import { formatDateTime } from "@renderer/lib/date-time";
import { AuthLayout, PaneHeading } from "../auth/split-layout";
import { backupKindLabel } from "../backup/backup-format";
import { defaultRetryable, RestoreDialog, type RestoreTarget } from "../backup/restore-dialog";
import { damageMessage, recoveryStatusLabel } from "./recovery-format";

type ScanState = { name: "scanning" } | { name: "failed" } | { name: "ready"; scan: RecoveryScan };

const restoreDescription =
  "This puts the backup in place of the damaged data. The damaged file is kept, renamed, in the Vendora data folder. Vendora restarts when it's done.";

const retryable: ReadonlySet<RestoreRefusal> = new Set([
  ...defaultRetryable,
  "set-aside-failed",
  "swap-failed",
]);

function StatusWord({ status }: { status: RecoveryBackup["status"] }) {
  const label = recoveryStatusLabel(status);
  if (status === "good") {
    return (
      <span className="inline-flex items-center gap-100 text-success">
        <CircleCheckIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
        {label}
      </span>
    );
  }
  if (status === "password-protected") {
    return (
      <span className="inline-flex items-center gap-100 text-secondary">
        <LockIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-100 text-critical">
      <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
      {label}
    </span>
  );
}

export function RecoveryScreen() {
  const [state, setState] = useState<ScanState>({ name: "scanning" });
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    window.vendora.recovery
      .scan()
      .then((scan) => setState({ name: "ready", scan }))
      .catch(() => setState({ name: "failed" }));
  }, []);

  useEffect(load, [load]);

  const openDialog = (next: RestoreTarget, button: HTMLElement) => {
    opener.current = button;
    setTarget(next);
    setDialogOpen(true);
  };

  const chooseFile = async (button: HTMLElement) => {
    setPickFailed(false);
    try {
      const chosen = await window.vendora.recovery.chooseFile();
      if (!chosen) return;
      openDialog(
        {
          input: { kind: "picked", token: chosen.token },
          takenAt: chosen.takenAt,
          pickedFileName: chosen.fileName,
          encrypted: chosen.encrypted,
        },
        button,
      );
    } catch {
      setPickFailed(true);
    }
  };

  const copy = damageMessage();
  const scan = state.name === "ready" ? state.scan : null;
  const lastGood = scan?.backups.find((backup) => backup.fileName === scan.lastGood) ?? null;
  const newer = scan?.backups.filter((backup) => backup.fileName !== scan.lastGood) ?? [];
  const noBackup = state.name === "failed" || (scan !== null && lastGood === null);

  return (
    <AuthLayout>
      <div className="grid w-full max-w-[560px] gap-600">
        <PaneHeading title={copy.title} description={copy.body} />
        {state.name === "scanning" ? (
          <p
            role="status"
            className="m-0 text-center text-[length:var(--font-size-350)] text-secondary"
          >
            Checking backups…
          </p>
        ) : null}
        {lastGood ? (
          <section
            aria-labelledby="last-good-heading"
            className="grid gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
          >
            <div className="grid gap-200">
              <h2
                id="last-good-heading"
                className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
              >
                Last good backup
              </h2>
              <p className="m-0 text-[length:var(--font-size-350)] text-foreground tabular-nums">
                {formatDateTime(lastGood.takenAt)}
              </p>
              <p className="m-0 flex flex-wrap items-center gap-200 text-[length:var(--font-size-300)] text-secondary">
                <span>{backupKindLabel(lastGood.kind)}</span>
                <StatusWord status={lastGood.status} />
              </p>
            </div>
            <div>
              <Button
                autoFocus
                onClick={(event) =>
                  openDialog(
                    {
                      input: { kind: "listed", fileName: lastGood.fileName },
                      takenAt: lastGood.takenAt,
                      pickedFileName: null,
                      encrypted: lastGood.status === "password-protected",
                    },
                    event.currentTarget,
                  )
                }
              >
                Restore
              </Button>
            </div>
          </section>
        ) : null}
        {newer.length > 0 ? (
          <section aria-labelledby="newer-heading" className="grid gap-200">
            <h2
              id="newer-heading"
              className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
            >
              Newer backups that can't be used
            </h2>
            <ul className="m-0 grid list-none gap-100 p-0">
              {newer.map((backup) => (
                <li
                  key={backup.fileName}
                  className="flex min-h-[var(--height-row)] flex-wrap items-center justify-between gap-200 text-[length:var(--font-size-350)]"
                >
                  <span className="tabular-nums">{formatDateTime(backup.takenAt)}</span>
                  <StatusWord status={backup.status} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {noBackup ? (
          <section className="grid gap-100 text-[length:var(--font-size-350)]">
            <p className="m-0 text-foreground">No backup was found on this PC.</p>
            <p className="m-0 text-secondary">
              If you have a copy on a USB drive, choose it below. Otherwise: {supportContact}.
            </p>
          </section>
        ) : null}
        {state.name !== "scanning" ? (
          <div className="grid justify-items-start gap-200">
            <Button
              variant="secondary"
              autoFocus={noBackup}
              onClick={(event) => void chooseFile(event.currentTarget)}
            >
              Choose a backup file…
            </Button>
            {pickFailed ? (
              <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-critical">
                Couldn't open the file picker. Try again.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="m-0 text-[length:var(--font-size-300)] text-secondary">{supportContact}</p>
      </div>
      {target ? (
        <RestoreDialog
          target={target}
          open={dialogOpen}
          finalFocus={opener}
          onOpenChange={setDialogOpen}
          restore={window.vendora.recovery.restore}
          description={restoreDescription}
          retryable={retryable}
          onRefused={load}
        />
      ) : null}
    </AuthLayout>
  );
}
