import { useCallback, useEffect, useState } from "react";

import { Switch } from "@base-ui/react/switch";
import { Button } from "@renderer/components/ui/button";
import { FieldError } from "@renderer/components/ui/field";
import { serviceErrorMessage } from "../auth/messages";

type LoadState = { name: "loading" } | { name: "error" } | { name: "ready"; enabled: boolean };

export function MiscItemSetting() {
  const [state, setState] = useState<LoadState>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    window.vendora.settings
      .getMiscItemEnabled()
      .then(({ enabled }) => setState({ name: "ready", enabled }))
      .catch(() => setState({ name: "error" }));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setState({ name: "loading" });
    load();
  };

  const save = async (enabled: boolean) => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await window.vendora.settings.setMiscItemEnabled(enabled);
      setState({ name: "ready", enabled: result.enabled });
      setSaved(true);
    } catch {
      setError(serviceErrorMessage);
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="misc-item-heading"
      className="grid w-[420px] max-w-full gap-400 rounded-300 border border-line-card bg-surface-secondary p-600"
    >
      <h2
        id="misc-item-heading"
        className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground"
      >
        Misc item
      </h2>
      <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
        Lets the cashier sell goods that aren&apos;t in the catalog at a price they type.
      </p>
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
          <label className="flex min-h-[var(--height-control-md)] cursor-default items-center justify-between gap-400 text-[length:var(--font-size-350)]">
            <span className="text-foreground">Allow misc item at checkout</span>
            <span className="flex items-center gap-200">
              <span className="text-secondary">{state.enabled ? "On" : "Off"}</span>
              <Switch.Root
                checked={state.enabled}
                disabled={pending}
                onCheckedChange={(checked) => void save(checked)}
                className="relative inline-flex h-[20px] w-[40px] shrink-0 items-center rounded-full border border-input bg-transparent outline-none hover:bg-surface-hover focus-visible:shadow-focus data-[checked]:border-transparent data-[checked]:bg-fill-brand data-[checked]:hover:bg-fill-brand-hover data-[disabled]:pointer-events-none data-[disabled]:cursor-default data-[checked]:data-[disabled]:bg-[var(--color-bg-fill-brand-disabled)]"
              >
                <Switch.Thumb className="block size-[12px] translate-x-[4px] rounded-full bg-icon-muted transition-transform duration-[var(--duration-100)] ease-[var(--ease-out)] data-[checked]:translate-x-[24px] data-[checked]:bg-on-brand data-[disabled]:bg-[var(--color-text-disabled)] data-[checked]:data-[disabled]:bg-on-brand" />
              </Switch.Root>
            </span>
          </label>
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <p role="status" className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {saved ? "Saved." : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
