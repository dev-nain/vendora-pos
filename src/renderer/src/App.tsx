import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { AppShell } from "./auth/app-shell";
import { LockScreen } from "./auth/lock-screen";
import { LoginScreen } from "./auth/login-screen";

type AuthView =
  | { name: "starting" }
  | { name: "login" }
  | { name: "shell"; user: SafeUser }
  | { name: "locked"; user: SafeUser };

export function App() {
  const [view, setView] = useState<AuthView>({ name: "starting" });

  useEffect(() => {
    void window.vendora.auth
      .current()
      .then((user) => setView(user ? { name: "shell", user } : { name: "login" }))
      .catch(() => setView({ name: "login" }));
  }, []);

  const toShell = (user: SafeUser) => setView({ name: "shell", user });
  const toLogin = () => setView({ name: "login" });

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
      return <LockScreen user={view.user} onUnlocked={toShell} onLogInWithPassword={toLogin} />;
  }
}
