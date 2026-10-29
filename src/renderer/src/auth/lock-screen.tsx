import { LockIcon } from "lucide-react";
import { useState } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Avatar } from "./avatar";
import { serviceErrorMessage } from "./messages";
import { PinPad } from "./pin-pad";
import { roleLabel } from "./role-label";
import { SplitLayout } from "./split-layout";
import { usePinCooldown } from "./use-pin-cooldown";

interface LockScreenProps {
  user: SafeUser;
  onUnlocked: (user: SafeUser) => void;
  onSwitchUser: () => void;
  onLogInWithPassword: () => void;
}

export function LockScreen({
  user,
  onUnlocked,
  onSwitchUser,
  onLogInWithPassword,
}: LockScreenProps) {
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
    <SplitLayout>
      <div className="grid justify-items-center gap-300 text-center">
        <Avatar
          name={user.displayName}
          className="size-[64px] text-[length:var(--font-size-550)]"
        />
        <div className="flex items-center gap-200 text-foreground">
          <LockIcon aria-hidden="true" size={22} strokeWidth={2} className="text-icon-muted" />
          <h1 className="m-0 text-[length:var(--font-size-700)] leading-[var(--line-height-tight)] font-bold tracking-[var(--letter-spacing-heading)]">
            Locked
          </h1>
        </div>
        <p className="m-0 text-[length:var(--font-size-400)] text-secondary">
          <span className="font-semibold text-foreground">{user.displayName}</span> ·{" "}
          {roleLabel(user.role)}
        </p>
      </div>
      <PinPad
        userId={user.id}
        submitLabel="Unlock"
        cooldown={cooldown}
        submitPin={async (pin) => {
          const result = await window.vendora.auth.switchByPin(user.id, pin);
          if (result.ok) onUnlocked(result.user);
          return result;
        }}
        onUnauthenticated={onLogInWithPassword}
      />
      <div className="grid w-[336px] max-w-full gap-200">
        <div className="flex gap-200">
          <Button variant="secondary" onClick={onSwitchUser} className="flex-1">
            Switch user
          </Button>
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
    </SplitLayout>
  );
}
