import { cn } from "@renderer/lib/utils";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const last = words.length > 1 ? (words.at(-1) ?? "") : "";
  return (last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[40px] shrink-0 place-items-center rounded-full bg-fill-brand-secondary text-[length:var(--font-size-350)] font-bold text-brand",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
