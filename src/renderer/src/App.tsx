import { useCallback, useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { AppShell } from "./auth/app-shell";
import { LockScreen } from "./auth/lock-screen";
import { LoginScreen } from "./auth/login-screen";
import { PinSwitchScreen } from "./auth/pin-switch-screen";

type AuthView =
  | { name: "starting" }
  | { name: "login" }
  | { name: "shell"; user: SafeUser }
  | { name: "locked"; user: SafeUser }
  | { name: "switch"; user: SafeUser };

export function App() {
  const [view, setView] = useState<AuthView>({ name: "starting" });

  useEffect(() => {
    void window.vendora.auth
      .current()
      .then((state) => {
        if (!state) setView({ name: "login" });
        else if (state.locked) setView({ name: "locked", user: state.user });
        else setView({ name: "shell", user: state.user });
      })
      .catch(() => setView({ name: "login" }));
  }, []);

  const toShell = (user: SafeUser) => setView({ name: "shell", user });
  const toLogin = useCallback(() => setView({ name: "login" }), []);

  switch (view.name) {
    case "starting":
      return <div className="min-h-screen bg-page" />;
    case "login":
      return <LoginScreen onLoggedIn={toShell} />;
    case "shell":
      return (
        <AppShell
          user={view.user}
          onLock={() => setView({ name: "locked", user: view.user })}
          onLoggedOut={toLogin}
        />
      );
    case "locked":
      return (
        <LockScreen
          user={view.user}
          onUnlocked={toShell}
          onSwitchUser={() => setView({ name: "switch", user: view.user })}
          onLogInWithPassword={toLogin}
        />
      );
    case "switch":
      return (
        <PinSwitchScreen
          currentUserId={view.user.id}
          onBack={() => setView({ name: "locked", user: view.user })}
          onSwitched={toShell}
          onUnauthenticated={toLogin}
        />
      );
  }
}
