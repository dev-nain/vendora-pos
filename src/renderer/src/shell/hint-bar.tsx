import { Kbd } from "@renderer/components/ui/kbd";

export type Hint = [keys: string, label: string];

export function HintBar({ hints, error }: { hints: Hint[]; error?: string | null }) {
  return (
    <footer className="flex items-center gap-[18px] border-l border-line-card bg-surface px-400 text-[length:var(--font-size-300)] text-secondary">
      <div className="flex flex-1 items-center gap-[18px]">
        {hints.map(([keys, label]) => (
          <span key={keys} className="inline-flex items-center gap-[6px]">
            <Kbd>{keys}</Kbd>
            {label}
          </span>
        ))}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-critical">
          {error}
        </p>
      ) : null}
    </footer>
  );
}
