import { CircleXIcon } from "lucide-react";

export function ErrorLine({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="m-0 flex items-center gap-100 text-[length:var(--font-size-350)] font-medium text-critical"
    >
      <CircleXIcon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
      {children}
    </p>
  );
}
