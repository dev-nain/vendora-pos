import { LockIcon, LogOutIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { AutoLockSetting } from "../settings/auto-lock-setting";
import { Avatar } from "./avatar";
import { serviceErrorMessage } from "./messages";
import { roleLabel } from "./role-label";
import { Wordmark } from "./split-layout";
import { UsersScreen } from "../users/users-screen";

interface AppShellProps {
  user: SafeUser;
  onLock: () => void;
  onLoggedOut: () => void;
}

export function AppShell({ user, onLock, onLoggedOut }: AppShellProps) {
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "users">("home");
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
      <header className="flex h-[64px] shrink-0 items-center gap-400 bg-page px-500">
        <Wordmark className="text-[length:var(--font-size-450)] text-foreground" />
        <div className="flex-1" />
        <div className="flex items-center gap-300 border-l border-line pl-400">
          <Avatar
            name={user.displayName}
            className="size-[36px] text-[length:var(--font-size-300)]"
          />
          <div className="grid leading-[var(--line-height-tight)]">
            <span className="text-[length:var(--font-size-400)] font-semibold text-foreground">
              {user.displayName}
            </span>
            <span className="text-[length:var(--font-size-350)] text-tertiary">
              {roleLabel(user.role)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-200">
          {user.role === "owner" ? (
            <Button variant="secondary" onClick={() => setPage("users")}>
              <UsersIcon aria-hidden="true" size={16} strokeWidth={2} />
              Users
            </Button>
          ) : null}
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
      {page === "users" ? (
        <UsersScreen
          currentUserId={user.id}
          onBack={() => setPage("home")}
          onSessionEnded={onLoggedOut}
        />
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center gap-200 text-secondary">
          <p className="m-0">
            Signed in as {user.displayName} ({roleLabel(user.role)}).
          </p>
          {user.role === "owner" ? <AutoLockSetting /> : null}
          {error ? (
            <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-critical">
              {error}
            </p>
          ) : null}
        </main>
      )}
    </div>
  );
}
