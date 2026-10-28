import { LockIcon, LogOutIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { serviceErrorMessage } from "./messages";
import { roleLabel } from "./role-label";

interface AppShellProps {
  user: SafeUser;
  onLock: () => void;
  onLoggedOut: () => void;
}

export function AppShell({ user, onLock, onLoggedOut }: AppShellProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        onLock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onLock]);

  const logOut = async () => {
    try {
      await window.vendora.auth.logout();
      onLoggedOut();
    } catch {
      setError(serviceErrorMessage);
    }
  };

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-page">
      <header className="flex h-[var(--height-control-lg)] shrink-0 items-center justify-between border-b border-line bg-surface px-400">
        <span className="text-[length:var(--font-size-450)] font-semibold tracking-[var(--letter-spacing-tight)] text-foreground">
          vendora<span className="text-fill-brand">.</span>
        </span>
        <div className="flex items-center gap-200">
          <span className="font-medium text-foreground">{user.displayName}</span>
          <span className="text-[length:var(--font-size-350)] text-secondary">
            {roleLabel(user.role)}
          </span>
          <Button variant="secondary" autoFocus data-lock-trigger onClick={onLock}>
            <LockIcon aria-hidden="true" size={16} strokeWidth={2} />
            Lock
            <Kbd>Ctrl L</Kbd>
          </Button>
          <Button variant="ghost" onClick={logOut}>
            <LogOutIcon aria-hidden="true" size={16} strokeWidth={2} />
            Log out
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-200 text-secondary">
        <p className="m-0">
          Signed in as {user.displayName} ({roleLabel(user.role)}).
        </p>
        {error ? (
          <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-critical">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
