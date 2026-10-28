import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { LoginScreen } from "./auth/login-screen";
import { roleLabel } from "./auth/role-label";

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
      return (
        <main className="flex min-h-screen items-center justify-center bg-page text-secondary">
          Signed in as {view.user.displayName} ({roleLabel(view.user.role)}).
        </main>
      );
  }
}
