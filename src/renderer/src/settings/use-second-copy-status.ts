import type { SecondCopyStatus } from "@shared/settings";
import { useCallback, useEffect, useState } from "react";

const refreshMs = 60 * 1000;

export type SecondCopyState =
  | { name: "loading" }
  | { name: "error" }
  | { name: "ready"; status: SecondCopyStatus };

export function useSecondCopyStatus() {
  const [state, setState] = useState<SecondCopyState>({ name: "loading" });

  const load = useCallback(() => {
    window.vendora.settings
      .getSecondCopy()
      .then((status) => setState({ name: "ready", status }))
      .catch(() => setState((current) => (current.name === "ready" ? current : { name: "error" })));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load]);

  const reload = () => {
    setState({ name: "loading" });
    load();
  };

  const setStatus = (status: SecondCopyStatus) => setState({ name: "ready", status });

  return { state, reload, setStatus };
}
