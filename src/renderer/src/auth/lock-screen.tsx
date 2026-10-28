import { LockIcon } from "lucide-react";
import { useState } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { serviceErrorMessage } from "./messages";
import { PinPad } from "./pin-pad";
import { roleLabel } from "./role-label";
import { usePinCooldown } from "./use-pin-cooldown";

interface LockScreenProps {
  user: SafeUser;
  onUnlocked: (user: SafeUser) => void;
  onLogInWithPassword: () => void;
}

export function LockScreen({ user, onUnlocked, onLogInWithPassword }: LockScreenProps) {
  const cooldown = usePinCooldown(user.id);
  const [error, setError] = useState<string | null>(null);

  const logInWithPassword = async () => {
    try {
      await window.vendora.auth.logout();
      onLogInWithPassword();
    } catch {
      setError(serviceErrorMessage);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center overflow-x-hidden bg-page p-600">
      <section className="flex w-[420px] flex-col gap-400 rounded-300 border border-line bg-surface p-600 shadow-200">
        <div className="grid justify-items-center gap-100">
          <div className="flex items-center gap-200 text-foreground">
            <LockIcon aria-hidden="true" size={24} strokeWidth={2} className="text-icon-muted" />
            <h1 className="m-0 text-[length:var(--font-size-550)] font-semibold">Locked</h1>
          </div>
          <p className="m-0 text-[length:var(--font-size-450)] font-semibold text-foreground">
            {user.displayName}
          </p>
          <p className="m-0 text-[length:var(--font-size-350)] text-secondary">
            {roleLabel(user.role)}
          </p>
        </div>
        <PinPad
          userId={user.id}
          submitLabel="Unlock"
          cooldown={cooldown}
          onSuccess={onUnlocked}
          onUnauthenticated={onLogInWithPassword}
        />
        <div className="grid gap-200">
          <div className="flex gap-200">
            <Button variant="secondary" onClick={logInWithPassword} className="flex-1">
              Log in with password
            </Button>
          </div>
          {error ? (
            <p role="alert" className="m-0 text-[length:var(--font-size-350)] text-critical">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
