import { InfoIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@renderer/lib/utils";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function Wordmark({ className, onInverse }: { className?: string; onInverse?: boolean }) {
  return (
    <span
      className={cn(
        "leading-none font-extrabold tracking-[var(--letter-spacing-tight)] whitespace-nowrap",
        className,
      )}
    >
      vendora
      <span
        className={onInverse ? "text-fill-highlight dark:text-on-highlight" : "text-fill-brand"}
      >
        .
      </span>
    </span>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    window.vendora.app
      .getInfo()
      .then((info) => {
        if (active) setVersion(info.version);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return version;
}

function CounterPanel() {
  const now = useNow();
  const version = useAppVersion();
  const time = timeFormat.formatToParts(now);
  const clock = time
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const period = time.find((part) => part.type === "dayPeriod")?.value.toUpperCase();

  return (
    <aside className="m-400 flex min-h-0 flex-col gap-800 overflow-hidden rounded-500 bg-surface-secondary px-[44px] py-1000 text-foreground">
      <Wordmark onInverse className="text-[length:var(--font-size-700)]" />
      <div>
        <p className="m-0 flex items-baseline gap-300 leading-none tabular-nums">
          <span className="text-[84px] font-medium tracking-[-0.05em]">{clock}</span>
          <span className="text-[length:var(--font-size-550)] text-secondary">{period}</span>
        </p>
        <p className="m-0 mt-300 text-[length:var(--font-size-450)] text-secondary">
          {dateFormat.format(now)}
        </p>
      </div>
      {version ? (
        <dl className="m-0 mt-auto grid gap-300 border-t border-line pt-600">
          <div className="flex items-center gap-300 text-secondary">
            <InfoIcon aria-hidden="true" size={18} strokeWidth={2} />
            <dt>Vendora version</dt>
            <dd className="m-0 ml-auto tabular-nums text-[length:var(--font-size-350)] font-semibold text-foreground">
              {version}
            </dd>
          </div>
        </dl>
      ) : null}
    </aside>
  );
}

export function SplitLayout({ children, back }: { children: ReactNode; back?: ReactNode }) {
  return (
    <main className="grid h-screen grid-cols-[520px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-page">
      <CounterPanel />
      <div className="relative flex min-h-0 min-w-0 flex-col overflow-y-auto p-800">
        {back ? <div className="absolute top-400 left-400">{back}</div> : null}
        <div className="m-auto flex w-full flex-col items-center gap-600">{children}</div>
      </div>
    </main>
  );
}

export function PaneHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="grid justify-items-center gap-100 text-center">
      <h1 className="m-0 text-[length:var(--font-size-700)] leading-[var(--line-height-tight)] font-bold tracking-[var(--letter-spacing-heading)] text-foreground">
        {title}
      </h1>
      {description ? (
        <p className="m-0 text-[length:var(--font-size-400)] text-secondary">{description}</p>
      ) : null}
    </header>
  );
}
