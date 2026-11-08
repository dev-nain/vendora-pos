const MAX_GAP_MS = 30;
const MIN_CHARS = 4;

export interface BurstEvent {
  startedBurst: boolean;
  scan: string | null;
}

export interface BurstDetector {
  feed(key: string, timeStamp: number): BurstEvent;
  reset(): void;
}

export function restoreField(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const modifierKeys = new Set(["Shift", "CapsLock", "Control", "Alt", "Meta"]);

export function createBurstDetector(): BurstDetector {
  let chars: string[] = [];
  let last = 0;

  const reset = () => {
    chars = [];
  };

  return {
    reset,
    feed(key, timeStamp) {
      if (modifierKeys.has(key)) return { startedBurst: false, scan: null };
      if (key.length === 1) {
        const continues = chars.length > 0 && timeStamp - last <= MAX_GAP_MS;
        if (continues) chars.push(key);
        else chars = [key];
        last = timeStamp;
        return { startedBurst: !continues, scan: null };
      }
      const isScan = key === "Enter" && chars.length >= MIN_CHARS && timeStamp - last <= MAX_GAP_MS;
      const scan = isScan ? chars.join("") : null;
      reset();
      return { startedBurst: false, scan };
    },
  };
}
