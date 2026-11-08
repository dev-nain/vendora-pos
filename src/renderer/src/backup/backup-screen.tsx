import { CheckIcon, CircleXIcon, InfoIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import type { BackupStatus } from "@shared/backup";
import { Button } from "@renderer/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table";
import { formatDateTime } from "@renderer/lib/date-time";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { backupKindLabel, formatBackupSize } from "./backup-format";
import { RestoreDialog, type RestoreTarget } from "./restore-dialog";

const restoreDescription =
  "This replaces all current data with this backup. Your current data is backed up first, and Vendora restarts when it's done.";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready"; status: BackupStatus };

interface BackupScreenProps {
  onSessionEnded: () => void;
}

export function BackupScreen({ onSessionEnded }: BackupScreenProps) {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [backingUp, setBackingUp] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState<RestoreTarget | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const running = useRef(false);

  const handleFailure = useCallback(
    (cause: unknown): boolean => {
      if (!isSessionError(cause)) return false;
      onSessionEnded();
      return true;
    },
    [onSessionEnded],
  );

  const load = useCallback(() => {
    window.vendora.backup
      .status()
      .then((status) => setState({ name: "ready", status }))
      .catch((cause: unknown) => {
        if (!handleFailure(cause)) setState({ name: "error" });
      });
  }, [handleFailure]);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const backUp = async () => {
    if (running.current) return;
    running.current = true;
    setBackingUp(true);
    setOutcome(null);
    try {
      const result = await window.vendora.backup.run();
      setOutcome(
        result.ok ? { ok: true, text: "Backup finished." } : { ok: false, text: result.message },
      );
      load();
    } catch (cause) {
      if (!handleFailure(cause)) setOutcome({ ok: false, text: serviceErrorMessage });
    } finally {
      running.current = false;
      setBackingUp(false);
    }
  };

  const openDialog = (next: RestoreTarget, button: HTMLElement) => {
    opener.current = button;
    setTarget(next);
    setDialogOpen(true);
  };

  const chooseFile = async (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    setOutcome(null);
    try {
      const chosen = await window.vendora.backup.chooseFile();
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
    } catch (cause) {
      if (!handleFailure(cause)) setOutcome({ ok: false, text: serviceErrorMessage });
    }
  };

  if (state.name === "loading") {
    return (
      <div className="grid gap-500">
        <Heading />
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">Loading…</p>
      </div>
    );
  }

  if (state.name === "error") {
    return (
      <div className="grid gap-500">
        <Heading />
        <div className="grid justify-items-start gap-200">
          <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {serviceErrorMessage}
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { status } = state;
  const blocked = status.restoreBlock !== null;

  return (
    <div className="grid gap-500">
      <Heading />
      <section
        aria-labelledby="last-backup-heading"
        className="flex flex-wrap items-center justify-between gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
      >
        <div className="grid gap-100">
          <h2
            id="last-backup-heading"
            className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
          >
            Last backup
          </h2>
          {status.lastBackupAt ? (
            <p className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-secondary">
              <CheckIcon
                aria-hidden="true"
                size={14}
                strokeWidth={2}
                className="shrink-0 text-success"
              />
              {formatDateTime(status.lastBackupAt)}
            </p>
          ) : (
            <p className="m-0 text-[length:var(--font-size-350)] text-secondary">No backups yet</p>
          )}
          {status.lastFailure ? (
            <p className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-critical">
              <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
              Failed {formatDateTime(status.lastFailure.at)}: {status.lastFailure.reason}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-200">
          <Button onClick={() => void backUp()}>{backingUp ? "Backing up…" : "Backup now"}</Button>
          <Button variant="secondary" onClick={(event) => void chooseFile(event)}>
            Restore from file…
          </Button>
        </div>
      </section>
      <p
        role="status"
        className={
          outcome && !outcome.ok
            ? "m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical empty:hidden"
            : "m-0 text-[length:var(--font-size-350)] text-secondary empty:hidden"
        }
      >
        {outcome && !outcome.ok ? (
          <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
        ) : null}
        {outcome?.text}
      </p>
      {status.restoreBlock ? (
        <p
          role="status"
          className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] text-secondary"
        >
          <InfoIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
          {status.restoreBlock}
        </p>
      ) : null}
      {status.backups.length === 0 ? (
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">No backups yet</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date and time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.backups.map((file) => (
              <TableRow key={file.fileName}>
                <TableCell>{formatDateTime(file.takenAt)}</TableCell>
                <TableCell>{backupKindLabel(file.kind)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBackupSize(file.sizeBytes)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="secondary"
                    disabled={blocked}
                    aria-label={`Restore backup from ${formatDateTime(file.takenAt)}`}
                    onClick={(event) =>
                      openDialog(
                        {
                          input: { kind: "listed", fileName: file.fileName },
                          takenAt: file.takenAt,
                          pickedFileName: null,
                          encrypted: file.encrypted,
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    Restore
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {target ? (
        <RestoreDialog
          target={target}
          open={dialogOpen}
          finalFocus={opener}
          onOpenChange={setDialogOpen}
          restore={window.vendora.backup.restore}
          description={restoreDescription}
          onRefused={load}
          onSessionEnded={onSessionEnded}
        />
      ) : null}
    </div>
  );
}

function Heading() {
  return (
    <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
      Backup
    </h1>
  );
}
