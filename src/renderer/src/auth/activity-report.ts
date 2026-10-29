export function createActivityReporter(
  report: () => void,
  intervalMs = 1000,
  now: () => number = Date.now,
): () => void {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < intervalMs) return;
    last = at;
    report();
  };
}
