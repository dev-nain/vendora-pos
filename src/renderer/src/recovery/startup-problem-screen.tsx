import { useState } from "react";

import type { StartupState } from "@shared/recovery";
import { supportContact } from "@shared/support";
import { Button } from "@renderer/components/ui/button";
import { AuthLayout, PaneHeading } from "../auth/split-layout";
import { startupProblemCopy } from "./recovery-format";

type ProblemState = Exclude<StartupState, { mode: "normal" | "damaged" }>;

export function StartupProblemScreen({ state }: { state: ProblemState }) {
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = startupProblemCopy(state);

  const retry = () => {
    setRetrying(true);
    setFailed(false);
    window.vendora.recovery.retry().catch(() => {
      setRetrying(false);
      setFailed(true);
    });
  };

  return (
    <AuthLayout>
      <div className="grid w-full max-w-[560px] gap-600">
        <PaneHeading title={copy.title} description={copy.body} />
        {state.mode === "open-failed" ? (
          <div className="grid justify-items-center gap-200">
            <Button autoFocus disabled={retrying} onClick={retry}>
              {retrying ? "Restarting…" : "Retry"}
            </Button>
            {failed ? (
              <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-critical">
                Couldn't restart Vendora. Close it and open it again.
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="m-0 text-center text-[length:var(--font-size-300)] text-secondary">
          {supportContact}
        </p>
      </div>
    </AuthLayout>
  );
}
