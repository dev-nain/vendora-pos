import { CircleXIcon, DeleteIcon, TimerIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { SafeUser } from "@shared/auth";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { formatCooldown } from "./cooldown";
import { isUnauthenticatedError, serviceErrorMessage } from "./messages";
import { appendDigit, digitFromKey, PIN_MIN_LENGTH, sanitizePin } from "./pin-entry";
import type { PinCooldown } from "./use-pin-cooldown";

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

const digitKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface PinPadProps {
  userId: string;
  submitLabel: string;
  cooldown: PinCooldown;
  onSuccess: (user: SafeUser) => void;
  onUnauthenticated: () => void;
  onEscape?: () => void;
}

export function PinPad({
  userId,
  submitLabel,
  cooldown,
  onSuccess,
  onUnauthenticated,
  onEscape,
}: PinPadProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = cooldown.active;

  useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [locked]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pending || locked) return;
    if (value.length < PIN_MIN_LENGTH) {
      setError("Enter 4 to 6 digits");
      inputRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);
    cooldown.clear(userId);
    const attempted = value;
    setValue("");
    try {
      const result = await window.vendora.auth.switchByPin(userId, attempted);
      if (result.ok) {
        onSuccess(result.user);
        return;
      }
      if (result.reason === "pin-locked") cooldown.start(userId, result.retryAfterMs);
      else setError(result.message);
    } catch (caught) {
      if (isUnauthenticatedError(caught)) {
        onUnauthenticated();
        return;
      }
      setError(serviceErrorMessage);
    }
    setPending(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (onEscape) onEscape();
      else setValue("");
      return;
    }
    const digit = digitFromKey(event.key, event.code);
    if (digit !== null && event.key !== digit) {
      event.preventDefault();
      if (!locked) setValue((current) => appendDigit(current, digit));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-400">
      <Input
        ref={inputRef}
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        aria-label="PIN"
        readOnly={locked}
        aria-disabled={locked || undefined}
        value={value}
        onChange={(event) => setValue(sanitizePin(event.target.value))}
        onKeyDown={onKeyDown}
        className="min-h-[var(--height-control-lg)] text-center font-mono text-[length:var(--font-size-450)] tracking-[var(--letter-spacing-caps)]"
      />

      {error ? (
        <p
          role="alert"
          className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical"
        >
          <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
          {error}
        </p>
      ) : null}

      <div role="status">
        {locked || cooldown.ended ? (
          <div className="flex items-start gap-200 rounded-200 border border-line-warning bg-surface-warning p-300 text-foreground">
            <TimerIcon
              aria-hidden="true"
              size={20}
              strokeWidth={2}
              className="mt-[2px] shrink-0 text-icon-warning"
            />
            {locked ? (
              <>
                <span className="sr-only">Too many wrong PINs. Try again later.</span>
                <span aria-hidden="true">
                  Too many wrong PINs. Try again in{" "}
                  <span className="font-mono">{formatCooldown(cooldown.remainingMs)}</span>.
                </span>
              </>
            ) : (
              <span>You can try your PIN again.</span>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-200">
        {digitKeys.map((digit) => (
          <PadKey
            key={digit}
            disabled={locked}
            onMouseDown={keepFocus}
            onClick={() => setValue((current) => appendDigit(current, digit))}
          >
            {digit}
          </PadKey>
        ))}
        <PadKey
          disabled={locked}
          onMouseDown={keepFocus}
          onClick={() => setValue("")}
          className="text-[length:var(--font-size-350)] font-medium"
        >
          Clear
        </PadKey>
        <PadKey
          disabled={locked}
          onMouseDown={keepFocus}
          onClick={() => setValue((current) => appendDigit(current, "0"))}
        >
          0
        </PadKey>
        <PadKey
          aria-label="Delete digit"
          disabled={locked}
          onMouseDown={keepFocus}
          onClick={() => setValue((current) => current.slice(0, -1))}
        >
          <DeleteIcon aria-hidden="true" size={20} strokeWidth={2} />
        </PadKey>
      </div>

      <Button type="submit" size="lg" disabled={locked || pending} className="w-full">
        {submitLabel}
        <Kbd>Enter</Kbd>
      </Button>
    </form>
  );
}

function PadKey({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn(
        "min-h-[var(--height-control-lg)] font-mono text-[length:var(--font-size-450)]",
        className,
      )}
      {...props}
    />
  );
}
