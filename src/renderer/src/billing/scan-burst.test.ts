import { describe, expect, it } from "vitest";
import { createBurstDetector } from "./scan-burst";

function type(
  detector: ReturnType<typeof createBurstDetector>,
  text: string,
  from: number,
  gap: number,
) {
  let time = from;
  const events = [...text].map((char) => {
    const event = detector.feed(char, time);
    time += gap;
    return event;
  });
  return { events, next: time };
}

describe("createBurstDetector", () => {
  it("reports a 13-digit burst followed by Enter", () => {
    const detector = createBurstDetector();
    const { events, next } = type(detector, "8961014000011", 1000, 8);

    expect(events[0]?.startedBurst).toBe(true);
    expect(events.slice(1).every((event) => !event.startedBurst)).toBe(true);
    expect(detector.feed("Enter", next)).toEqual({ startedBurst: false, scan: "8961014000011" });
  });

  it("ignores Shift between characters", () => {
    const detector = createBurstDetector();
    detector.feed("A", 0);
    detector.feed("Shift", 5);
    detector.feed("B", 10);
    detector.feed("C", 20);
    detector.feed("1", 30);
    expect(detector.feed("Enter", 40).scan).toBe("ABC1");
  });

  it("does not report slow typing and starts a new burst at each slow key", () => {
    const detector = createBurstDetector();
    const { events, next } = type(detector, "89610", 0, 120);

    expect(events.every((event) => event.startedBurst)).toBe(true);
    expect(detector.feed("Enter", next)).toEqual({ startedBurst: false, scan: null });
  });

  it("does not report a burst without Enter", () => {
    const detector = createBurstDetector();
    type(detector, "89610140", 0, 8);
    expect(detector.feed("Enter", 5000).scan).toBeNull();
  });

  it("does not report Enter that comes after a pause", () => {
    const detector = createBurstDetector();
    const { next } = type(detector, "8961014", 0, 8);
    expect(detector.feed("Enter", next + 200).scan).toBeNull();
  });

  it("does not report a burst shorter than four characters", () => {
    const detector = createBurstDetector();
    const { next } = type(detector, "123", 0, 8);
    expect(detector.feed("Enter", next).scan).toBeNull();
  });

  it("forgets the burst after Enter and after another key", () => {
    const detector = createBurstDetector();
    const first = type(detector, "12345", 0, 8);
    detector.feed("Enter", first.next);
    expect(detector.feed("Enter", first.next + 5).scan).toBeNull();

    const second = type(detector, "12345", 1000, 8);
    detector.feed("Backspace", second.next);
    expect(detector.feed("Enter", second.next + 5).scan).toBeNull();
  });

  it("keeps a manual typist's field untouched", () => {
    const detector = createBurstDetector();
    detector.feed("5", 0);
    detector.feed("0", 400);
    expect(detector.feed("Enter", 800).scan).toBeNull();
  });
});
