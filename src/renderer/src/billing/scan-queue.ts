export type ScanOutcome = "continue" | "pause";

export interface ScanQueue {
  enqueue(code: string): void;
  pause(): void;
  resume(): void;
  dropCurrent(): void;
  readonly size: number;
}

export function createScanQueue(process: (code: string) => Promise<ScanOutcome>): ScanQueue {
  const waiting: string[] = [];
  let paused = false;
  let running = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!paused && waiting.length > 0) {
        const code = waiting.shift();
        if (code === undefined) break;
        try {
          if ((await process(code)) === "pause") paused = true;
        } catch {
          // a failed scan must not stop the ones behind it
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    enqueue(code) {
      waiting.push(code);
      void run();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      void run();
    },
    dropCurrent() {
      paused = false;
      void run();
    },
    get size() {
      return waiting.length;
    },
  };
}
