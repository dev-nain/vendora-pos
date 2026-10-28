import { Activity, useCallback, useEffect, useRef, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { AppShell } from "./auth/app-shell";
import { LockScreen } from "./auth/lock-screen";
import { LoginScreen } from "./auth/login-screen";
import { PinSwitchScreen } from "./auth/pin-switch-screen";
import { useActivityReport } from "./auth/use-activity-report";

type Overlay = null | "locked" | "switch";

type AuthView =
  | { name: "starting" }
  | { name: "login" }
  | { name: "signed-in"; user: SafeUser; overlay: Overlay };

const lockedOverlay = (view: AuthView): AuthView =>
  view.name === "signed-in" && view.overlay === null ? { ...view, overlay: "locked" } : view;

export function App() {
  const [view, setView] = useState<AuthView>({ name: "starting" });
  const savedFocus = useRef<Element | null>(null);

  useEffect(() => {
    void window.vendora.auth
      .current()
      .then((state) => {
        if (!state) setView({ name: "login" });
        else
          setView({ name: "signed-in", user: state.user, overlay: state.locked ? "locked" : null });
      })
      .catch(() => setView({ name: "login" }));
  }, []);

  useEffect(
    () =>
      window.vendora.auth.onLocked(() => {
        savedFocus.current ??= document.activeElement;
        setView(lockedOverlay);
      }),
    [],
  );

  useActivityReport(view.name === "signed-in" && view.overlay === null);

  const toLogin = useCallback(() => setView({ name: "login" }), []);

  const lock = () => {
    savedFocus.current ??= document.activeElement;
    setView(lockedOverlay);
    void window.vendora.auth.lock().catch(() => undefined);
  };

  const signedIn = (user: SafeUser) => {
    const sameUser = view.name === "signed-in" && view.user.id === user.id;
    setView({ name: "signed-in", user, overlay: null });
    if (sameUser) requestAnimationFrame(restoreFocus);
    else savedFocus.current = null;
  };

  const restoreFocus = () => {
    const target = savedFocus.current;
    savedFocus.current = null;
    if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
      target.focus();
    } else {
      document.querySelector<HTMLElement>("[data-lock-trigger]")?.focus();
    }
  };

  switch (view.name) {
    case "starting":
      return <div className="min-h-screen bg-page" />;
    case "login":
      return (
        <LoginScreen onLoggedIn={(user) => setView({ name: "signed-in", user, overlay: null })} />
      );
    case "signed-in":
      return (
        <>
          <Activity mode={view.overlay ? "hidden" : "visible"}>
            <AppShell key={view.user.id} user={view.user} onLock={lock} onLoggedOut={toLogin} />
          </Activity>
          {view.overlay === "locked" ? (
            <LockScreen
              user={view.user}
              onUnlocked={signedIn}
              onSwitchUser={() => setView({ ...view, overlay: "switch" })}
              onLogInWithPassword={toLogin}
            />
          ) : null}
          {view.overlay === "switch" ? (
            <PinSwitchScreen
              currentUserId={view.user.id}
              onBack={() => setView({ ...view, overlay: "locked" })}
              onSwitched={signedIn}
              onUnauthenticated={toLogin}
            />
          ) : null}
        </>
      );
  }
}
