import { useCallback, useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/button";

export function App() {
  const [version, setVersion] = useState<string | null>(null);

  const loadVersion = useCallback(() => {
    void window.vendora.app.getInfo().then((info) => setVersion(info.version));
  }, []);

  useEffect(loadVersion, [loadVersion]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-800">
      <section className="flex w-[420px] flex-col items-center gap-600 rounded-300 border border-line bg-surface p-800 shadow-200">
        <h1 className="m-0 text-[length:var(--font-size-900)] leading-[var(--line-height-tight)] font-semibold tracking-[var(--letter-spacing-tight)] text-foreground">
          vendora<span className="text-fill-brand">.</span>
        </h1>
        <p className="m-0 font-mono text-[length:var(--font-size-350)] text-secondary">
          {version ? `v${version}` : "…"}
        </p>
        <Button variant="secondary" onClick={loadVersion}>
          Refresh version
        </Button>
      </section>
    </main>
  );
}
