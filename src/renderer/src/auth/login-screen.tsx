import { CircleXIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Field, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { serviceErrorMessage } from "./messages";
import { PaneHeading, SplitLayout } from "./split-layout";

interface LoginScreenProps {
  onLoggedIn: (user: SafeUser) => void;
}

export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!username.trim()) {
      setError("Enter your username");
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Enter your password");
      passwordRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);
    const attemptedPassword = password;
    setPassword("");
    try {
      const result = await window.vendora.auth.login(username, attemptedPassword);
      if (result.ok) {
        onLoggedIn(result.user);
        return;
      }
      setError(result.message);
    } catch {
      setError(serviceErrorMessage);
    }
    setPending(false);
    passwordRef.current?.focus();
  };

  return (
    <SplitLayout>
      <PaneHeading title="Log in" />
      <section className="w-[400px] max-w-full rounded-400 border border-line-card bg-surface p-600 shadow-200">
        <form onSubmit={submit} noValidate className="grid gap-400">
          <Field>
            <FieldLabel>Username</FieldLabel>
            <Input
              ref={usernameRef}
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Password</FieldLabel>
            <Input
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical"
            >
              <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Logging in…" : "Log in"}
            {pending ? null : <Kbd>Enter</Kbd>}
          </Button>
        </form>
      </section>
    </SplitLayout>
  );
}
