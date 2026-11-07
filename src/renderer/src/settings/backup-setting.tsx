import { TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { FieldError } from "@renderer/components/ui/field";
import type { SecondCopyStatus } from "@shared/settings";
import { serviceErrorMessage } from "../auth/messages";
import { secondCopyRow } from "./second-copy-status";
import type { SecondCopyState } from "./use-second-copy-status";

interface BackupSettingProps {
  state: SecondCopyState;
  reload: () => void;
  setStatus: (status: SecondCopyStatus) => void;
}

const bodyClass = "m-0 text-[length:var(--font-size-350)]";

export function BackupSetting({ state, reload, setStatus }: BackupSettingProps) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const chooseButton = useRef<HTMLButtonElement>(null);

  const run = async (action: () => Promise<SecondCopyStatus>, focusChoose: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setSaved(false);
    try {
      const before = state.name === "ready" ? state.status.folder : null;
      const status = await action();
      setStatus(status);
      setSaved(status.folder !== before);
    } catch {
      setError(serviceErrorMessage);
    } finally {
      pending.current = false;
      if (focusChoose) setTimeout(() => chooseButton.current?.focus(), 0);
    }
  };

  const choose = () => void run(() => window.vendora.settings.chooseSecondCopyFolder(), false);
  const clear = () => void run(() => window.vendora.settings.clearSecondCopyFolder(), true);

  const status = state.name === "ready" ? state.status : null;
  const row = status ? secondCopyRow(status) : null;

  return (
    <section
      aria-labelledby="backup-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="backup-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Backup
      </h2>
      <p className={`${bodyClass} text-secondary`}>
        Vendora also saves each backup to this folder. Use a USB drive or a synced folder, so losing
        this PC doesn&apos;t lose your records.
      </p>
      {state.name === "loading" ? <p className={`${bodyClass} text-secondary`}>Loading…</p> : null}
      {state.name === "error" ? (
        <div className="grid gap-200">
          <p role="alert" className={`${bodyClass} text-secondary`}>
            {serviceErrorMessage}
          </p>
          <Button variant="secondary" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : null}
      {status && row ? (
        <>
          <div className="grid gap-050">
            <p className={`${bodyClass} text-secondary`}>Second copy folder</p>
            <p className={`${bodyClass} break-all text-foreground`}>{status.folder ?? "Not set"}</p>
          </div>
          {row.kind === "none" ? null : row.kind === "failed" ? (
            <p className={`${bodyClass} flex items-start gap-200 text-foreground`}>
              <TriangleAlertIcon
                aria-hidden="true"
                size={16}
                strokeWidth={2}
                className="mt-[2px] shrink-0 text-icon-warning"
              />
              <span>
                <span className="text-warning">{row.text}</span> {row.at}
              </span>
            </p>
          ) : (
            <p className={`${bodyClass} text-foreground`}>{row.text}</p>
          )}
          <div className="flex gap-200">
            <Button ref={chooseButton} variant="secondary" onClick={choose}>
              {status.folder === null ? "Choose folder" : "Change folder"}
            </Button>
            {status.folder === null ? null : (
              <Button variant="secondary" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <p role="status" className={`${bodyClass} text-secondary`}>
            {saved ? "Saved." : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
