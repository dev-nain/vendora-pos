import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ipcErrorMessages } from "@shared/ipc";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldError, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { serviceErrorMessage } from "../auth/messages";
import { autoLockInputMessage, parseAutoLockMinutes } from "./auto-lock-input";

type LoadState =
  | { name: "loading" }
  | { name: "error" }
  | { name: "ready"; minutes: number | null };

const statusText = (minutes: number | null): string => {
  if (minutes === null) return "Auto-lock is off";
  return `Locks after ${minutes} ${minutes === 1 ? "minute" : "minutes"} idle`;
};

const minutesText = (minutes: number | null): string => (minutes === null ? "" : String(minutes));

const refusalMessage = (error: unknown): string => {
  if (error instanceof Error) {
    for (const message of [ipcErrorMessages.forbidden, ipcErrorMessages.locked]) {
      if (error.message.includes(message)) return message;
    }
  }
  return serviceErrorMessage;
};

export function AutoLockSetting() {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    window.vendora.settings
      .getAutoLock()
      .then(({ minutes }) => {
        setState({ name: "ready", minutes });
        setText(minutesText(minutes));
      })
      .catch(() => setState({ name: "error" }));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const save = async (minutes: number | null) => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await window.vendora.settings.setAutoLock(minutes);
      setState({ name: "ready", minutes: result.minutes });
      setText(minutesText(result.minutes));
      setSaved(true);
    } catch (caught) {
      setError(refusalMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAutoLockMinutes(text);
    if (!parsed.ok) {
      setSaved(false);
      setError(autoLockInputMessage);
      return;
    }
    void save(parsed.minutes);
  };

  return (
    <section
      aria-labelledby="auto-lock-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="auto-lock-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Auto-lock
      </h2>
      {state.name === "loading" ? (
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">Loading…</p>
      ) : null}
      {state.name === "error" ? (
        <div className="grid gap-200">
          <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {serviceErrorMessage}
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {state.name === "ready" ? (
        <>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {statusText(state.minutes)}
          </p>
          <form onSubmit={submit} noValidate className="grid gap-200">
            <div className="flex items-end gap-200">
              <Field className="flex-1">
                <FieldLabel>Lock after (minutes)</FieldLabel>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Button type="submit" disabled={pending}>
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void save(null)}
              >
                Turn off
              </Button>
            </div>
            {error ? <FieldError role="alert">{error}</FieldError> : null}
            <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
              {saved ? "Saved." : ""}
            </p>
          </form>
        </>
      ) : null}
    </section>
  );
}
