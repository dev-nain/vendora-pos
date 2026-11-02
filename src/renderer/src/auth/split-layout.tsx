import { useEffect, useState, type ReactNode } from "react";

import { Brand } from "@renderer/components/brand";

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

export function AuthLayout({ children, back }: { children: ReactNode; back?: ReactNode }) {
  const version = useAppVersion();
  return (
    <main className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] bg-page">
      <header className="grid justify-items-start gap-200 p-400">
        <Brand className="text-[length:var(--font-size-300)] text-foreground" />
        {back}
      </header>
      <div className="flex min-h-0 overflow-y-auto px-800">
        <div className="m-auto flex w-full flex-col items-center gap-600 py-400">{children}</div>
      </div>
      <footer className="min-h-[var(--height-hint-bar)] px-400 py-200 text-[length:var(--font-size-300)] text-tertiary tabular-nums">
        {version ? `Vendora version ${version}` : null}
      </footer>
    </main>
  );
}

export function PaneHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="grid justify-items-center gap-100 text-center">
      <h1 className="m-0 font-display text-[length:var(--font-size-700)] leading-[36px] font-semibold text-foreground">
        {title}
      </h1>
      {description ? (
        <p className="m-0 text-[length:var(--font-size-350)] text-secondary">{description}</p>
      ) : null}
    </header>
  );
}
