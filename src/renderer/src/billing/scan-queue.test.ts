import { describe, expect, it } from "vitest";
import { createScanQueue, type ScanOutcome } from "./scan-queue";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createScanQueue", () => {
  it("processes codes in order, one at a time", async () => {
    const seen: string[] = [];
    let active = 0;
    let overlap = false;
    const queue = createScanQueue(async (code) => {
      active += 1;
      if (active > 1) overlap = true;
      await tick();
      seen.push(code);
      active -= 1;
      return "continue";
    });

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await tick();
    await tick();
    await tick();
    await tick();

    expect(seen).toEqual(["a", "b", "c"]);
    expect(overlap).toBe(false);
  });

  it("holds later codes while a prompt is open and runs them on resume", async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code): Promise<ScanOutcome> => {
      seen.push(code);
      return code === "weigh" ? "pause" : "continue";
    });

    queue.enqueue("weigh");
    queue.enqueue("x");
    queue.enqueue("y");
    await tick();
    expect(seen).toEqual(["weigh"]);
    expect(queue.size).toBe(2);

    queue.resume();
    await tick();
    expect(seen).toEqual(["weigh", "x", "y"]);
  });

  it("drops only the parked item and keeps the rest", async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code): Promise<ScanOutcome> => {
      seen.push(code);
      return code === "weigh" ? "pause" : "continue";
    });

    queue.enqueue("weigh");
    queue.enqueue("next");
    await tick();
    queue.dropCurrent();
    await tick();

    expect(seen).toEqual(["weigh", "next"]);
  });

  it("stays paused when paused from outside", async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code) => {
      seen.push(code);
      return "continue";
    });

    queue.pause();
    queue.enqueue("a");
    await tick();
    expect(seen).toEqual([]);

    queue.resume();
    await tick();
    expect(seen).toEqual(["a"]);
  });

  it("keeps going after a code fails", async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code) => {
      seen.push(code);
      if (code === "bad") throw new Error("boom");
      return "continue";
    });

    queue.enqueue("bad");
    queue.enqueue("good");
    await tick();
    await tick();

    expect(seen).toEqual(["bad", "good"]);
  });

  it("starts again for a code that arrives after the queue went idle", async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code) => {
      seen.push(code);
      return "continue";
    });

    queue.enqueue("a");
    await tick();
    queue.enqueue("b");
    await tick();

    expect(seen).toEqual(["a", "b"]);
  });
});
