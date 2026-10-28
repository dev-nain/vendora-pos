import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { AppShell } from "./auth/app-shell";
import { LoginScreen } from "./auth/login-screen";

type AuthView = { name: "starting" } | { name: "login" } | { name: "shell"; user: SafeUser };

export function App() {
  const [view, setView] = useState<AuthView>({ name: "starting" });

  useEffect(() => {
    void window.vendora.auth
      .current()
      .then((user) => setView(user ? { name: "shell", user } : { name: "login" }))
      .catch(() => setView({ name: "login" }));
  }, []);

  switch (view.name) {
    case "starting":
      return <div className="min-h-screen bg-page" />;
    case "login":
      return <LoginScreen onLoggedIn={(user) => setView({ name: "shell", user })} />;
    case "shell":
      return <AppShell user={view.user} onLoggedOut={() => setView({ name: "login" })} />;
  }
}
