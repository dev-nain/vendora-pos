import { LockIcon, LockOpenIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BackupPasswordStatus } from "@shared/backup";
import { Button } from "@renderer/components/ui/button";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { BackupPasswordDialog } from "./backup-password-dialog";
import type { BackupPasswordMode } from "./backup-password-form";

type LoadState =
  | { name: "loading" }
  | { name: "error" }
  | { name: "ready"; status: BackupPasswordStatus };

const bodyClass = "m-0 text-[length:var(--font-size-350)]";

function StateRow({ state }: { state: BackupPasswordStatus["state"] }) {
  if (state === "unreadable") {
    return (
      <p className={`${bodyClass} flex items-start gap-200 text-foreground`}>
        <TriangleAlertIcon
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="mt-[2px] shrink-0 text-icon-warning"
        />
        <span className="text-warning">
          This PC can&apos;t read the backup password, so backups are failing. Choose Change
          password and enter it again.
        </span>
      </p>
    );
  }
  const Icon = state === "on" ? LockIcon : LockOpenIcon;
  return (
    <p className={`${bodyClass} flex items-start gap-200 text-foreground`}>
      <Icon
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className="mt-[2px] shrink-0 text-icon-muted"
      />
      <span>
        {state === "on" ? "On. New backups are encrypted." : "Off. Backups aren't encrypted."}
      </span>
    </p>
  );
}

export function BackupPasswordSetting({ onSessionEnded }: { onSessionEnded: () => void }) {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [mode, setMode] = useState<BackupPasswordMode>("turn-on");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const firstButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const fetchStatus = useCallback(() => {
    window.vendora.backup.passwordStatus().then(
      (status) => setState({ name: "ready", status }),
      (cause: unknown) => {
        if (isSessionError(cause)) onSessionEnded();
        else setState({ name: "error" });
      },
    );
  }, [onSessionEnded]);

  useEffect(fetchStatus, [fetchStatus]);

  const retry = () => {
    setState({ name: "loading" });
    fetchStatus();
  };

  const current = state.name === "ready" ? state.status.state : null;

  const open = (next: BackupPasswordMode, button: HTMLElement) => {
    opener.current = button;
    setMode(next);
    setNotice("");
    setDialogOpen(true);
  };

  const changed = (status: BackupPasswordStatus, message: string) => {
    setState({ name: "ready", status });
    setNotice(message);
    if (status.state !== current) {
      requestAnimationFrame(() => {
        opener.current = firstButton.current;
      });
    }
  };

  return (
    <section
      aria-labelledby="backup-password-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="backup-password-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Backup password
      </h2>
      <p className={`${bodyClass} text-secondary`}>
        A password encrypts your backups, so a lost USB drive doesn&apos;t expose your records.
      </p>
      {state.name === "loading" ? <p className={`${bodyClass} text-secondary`}>Loading…</p> : null}
      {state.name === "error" ? (
        <div className="grid gap-200">
          <p role="alert" className={`${bodyClass} text-secondary`}>
            {serviceErrorMessage}
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {current ? (
        <>
          <StateRow state={current} />
          <div className="flex gap-200">
            {current === "off" ? (
              <Button
                ref={firstButton}
                variant="secondary"
                onClick={(event) => open("turn-on", event.currentTarget)}
              >
                Turn on…
              </Button>
            ) : (
              <>
                <Button
                  ref={firstButton}
                  variant="secondary"
                  onClick={(event) => open("change", event.currentTarget)}
                >
                  Change password…
                </Button>
                <Button
                  variant="secondary"
                  onClick={(event) => open("turn-off", event.currentTarget)}
                >
                  Turn off…
                </Button>
              </>
            )}
          </div>
          <p role="status" className={`${bodyClass} text-secondary`}>
            {notice}
          </p>
        </>
      ) : null}
      <BackupPasswordDialog
        mode={mode}
        open={dialogOpen}
        finalFocus={opener}
        onOpenChange={setDialogOpen}
        onChanged={changed}
        onSessionEnded={onSessionEnded}
      />
    </section>
  );
}
