export function formatCooldown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export const remainingMs = (deadline: number, now: number): number => Math.max(0, deadline - now);
