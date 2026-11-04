import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { serviceErrorMessage } from "../auth/messages";
import { BackOffice } from "./back-office";
import { HintBar, type Hint } from "./hint-bar";
import { TitleBar, type Area } from "./title-bar";

interface AppShellProps {
  user: SafeUser;
  onSwitchUser: () => void;
  onLoggedOut: () => void;
}

const hintsFor = (area: Area): Hint[] =>
  area === "sell"
    ? [["Ctrl+L", "Switch user"]]
    : [
        ["Ctrl+1", "Sell"],
        ["Ctrl+L", "Switch user"],
      ];

export function AppShell({ user, onSwitchUser, onLoggedOut }: AppShellProps) {
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<Area>("sell");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        onSwitchUser();
      } else if (key === "1") {
        event.preventDefault();
        setArea("sell");
      } else if (key === "2") {
        event.preventDefault();
        setArea("back-office");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSwitchUser]);

  const logOut = async () => {
    try {
      await window.vendora.auth.logout();
      onLoggedOut();
    } catch {
      setError(serviceErrorMessage);
    }
  };

  return (
    <div className="grid h-screen grid-rows-[var(--height-title-bar)_minmax(0,1fr)_var(--height-hint-bar)] overflow-hidden bg-page">
      <TitleBar
        user={user}
        area={area}
        onAreaChange={setArea}
        onSwitchUser={onSwitchUser}
        onLogOut={() => void logOut()}
      />
      {area === "sell" ? (
        <main
          id="panel-sell"
          role="tabpanel"
          aria-labelledby="tab-sell"
          className="grid min-h-0 place-items-center rounded-tl-300 border-t border-l border-line-card bg-surface text-secondary"
        >
          <p className="m-0">Checkout isn't set up yet.</p>
        </main>
      ) : (
        <BackOffice currentUserId={user.id} onSessionEnded={onLoggedOut} />
      )}
      <HintBar hints={hintsFor(area)} error={error} />
    </div>
  );
}
