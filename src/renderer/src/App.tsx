import { Activity, useCallback, useEffect, useRef, useState } from "react";

import type { SafeUser } from "@shared/auth";
import type { StartupState } from "@shared/recovery";
import { AppShell } from "./shell/app-shell";
import { CreateFirstUserScreen } from "./auth/create-first-user-screen";
import { LoginScreen } from "./auth/login-screen";
import { PinSwitchScreen } from "./auth/pin-switch-screen";
import { RecoveryScreen } from "./recovery/recovery-screen";
import { StartupProblemScreen } from "./recovery/startup-problem-screen";

type AuthView =
  | { name: "starting" }
  | { name: "recovery" }
  | { name: "startup-problem"; state: Exclude<StartupState, { mode: "normal" | "damaged" }> }
  | { name: "setup" }
  | { name: "login" }
  | { name: "signed-in"; user: SafeUser; switching: boolean };

export function App() {
  const [view, setView] = useState<AuthView>({ name: "starting" });
  const savedFocus = useRef<Element | null>(null);

  useEffect(() => {
    const toAuth = () =>
      window.vendora.auth
        .current()
        .then(async (state) => {
          if (state) return setView({ name: "signed-in", user: state.user, switching: false });
          const needsSetup = await window.vendora.auth.needsSetup();
          setView(needsSetup ? { name: "setup" } : { name: "login" });
        })
        .catch(() => setView({ name: "login" }));

    void window.vendora.startup
      .state()
      .catch((): StartupState => ({ mode: "normal" }))
      .then((startup) => {
        if (startup.mode === "damaged") return setView({ name: "recovery" });
        if (startup.mode !== "normal") return setView({ name: "startup-problem", state: startup });
        return toAuth();
      });
  }, []);

  const toLogin = useCallback(() => {
    savedFocus.current = null;
    setView({ name: "login" });
  }, []);

  const restoreFocus = () => {
    const target = savedFocus.current;
    savedFocus.current = null;
    if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
      target.focus();
    } else {
      document.querySelector<HTMLElement>("[data-user-menu-trigger]")?.focus();
    }
  };

  const openSwitch = () => {
    savedFocus.current ??= document.activeElement;
    setView((current) =>
      current.name === "signed-in" ? { ...current, switching: true } : current,
    );
  };

  const closeSwitch = () => {
    setView((current) =>
      current.name === "signed-in" ? { ...current, switching: false } : current,
    );
    requestAnimationFrame(restoreFocus);
  };

  const signedIn = (user: SafeUser) => {
    const sameUser = view.name === "signed-in" && view.user.id === user.id;
    setView({ name: "signed-in", user, switching: false });
    if (sameUser) requestAnimationFrame(restoreFocus);
    else savedFocus.current = null;
  };

  switch (view.name) {
    case "starting":
      return <div className="min-h-screen bg-page" />;
    case "recovery":
      return <RecoveryScreen />;
    case "startup-problem":
      return <StartupProblemScreen state={view.state} />;
    case "setup":
      return <CreateFirstUserScreen onCreated={signedIn} onAccountExists={toLogin} />;
    case "login":
      return <LoginScreen onLoggedIn={signedIn} />;
    case "signed-in":
      return (
        <>
          <Activity mode={view.switching ? "hidden" : "visible"}>
            <AppShell
              key={view.user.id}
              user={view.user}
              onSwitchUser={openSwitch}
              onLoggedOut={toLogin}
            />
          </Activity>
          {view.switching ? (
            <PinSwitchScreen
              currentUserId={view.user.id}
              onBack={closeSwitch}
              onSwitched={signedIn}
              onUnauthenticated={toLogin}
            />
          ) : null}
        </>
      );
  }
}
