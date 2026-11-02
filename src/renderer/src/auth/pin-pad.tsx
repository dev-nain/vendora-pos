import { CircleXIcon, DeleteIcon, TimerIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@renderer/components/ui/button";
import { Kbd } from "@renderer/components/ui/kbd";
import { cn } from "@renderer/lib/utils";
import { formatCooldown } from "./cooldown";
import { isUnauthenticatedError, serviceErrorMessage } from "./messages";
import { appendDigit, digitFromKey, PIN_MIN_LENGTH, sanitizePin } from "./pin-entry";
import type { PinCooldown } from "./use-pin-cooldown";

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

const digitKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export type PinSubmitResult =
  | { ok: true }
  | { ok: false; reason: "pin-locked"; retryAfterMs: number; message: string }
  | { ok: false; reason: string; message: string };

interface PinPadProps {
  userId: string;
  submitLabel: string;
  cooldown: PinCooldown;
  submitPin: (pin: string) => Promise<PinSubmitResult>;
  onUnauthenticated: () => void;
  onEscape?: () => void;
}

export function PinPad({
  userId,
  submitLabel,
  cooldown,
  submitPin,
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
      const result = await submitPin(attempted);
      if (result.ok) return;
      if (result.reason === "pin-locked" && "retryAfterMs" in result) {
        cooldown.start(userId, result.retryAfterMs);
      } else setError(result.message);
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
    <form onSubmit={submit} noValidate className="grid w-[336px] max-w-full gap-400">
      <div className="relative mx-auto flex h-[44px] items-center justify-center rounded-full px-400 transition-shadow duration-[var(--duration-100)] has-[input:focus-visible]:shadow-focus">
        <span aria-hidden="true" className="flex items-center gap-[14px]">
          {Array.from({ length: Math.max(PIN_MIN_LENGTH, value.length) }, (_, index) => (
            <span
              key={index}
              className={cn(
                "size-400 rounded-full border-2 border-input transition-colors duration-[var(--duration-100)]",
                index < value.length && "border-foreground bg-foreground",
              )}
            />
          ))}
        </span>
        <input
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
          className="absolute inset-0 size-full cursor-default rounded-full opacity-0 outline-none"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="m-0 flex items-center justify-center gap-100 text-[length:var(--font-size-350)] font-semibold text-critical"
        >
          <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
          {error}
        </p>
      ) : null}

      <div role="status">
        {locked || cooldown.ended ? (
          <div className="flex items-start gap-200 rounded-300 border border-line-warning bg-surface-warning p-300 text-foreground">
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
                  <span className="tabular-nums">{formatCooldown(cooldown.remainingMs)}</span>.
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
          className="font-sans text-[length:var(--font-size-350)] font-semibold text-secondary"
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
          className="text-secondary"
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
        "min-h-[56px] min-w-[64px] tabular-nums text-[length:var(--font-size-550)] font-medium",
        className,
      )}
      {...props}
    />
  );
}
