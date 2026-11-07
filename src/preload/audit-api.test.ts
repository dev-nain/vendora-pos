import { describe, expect, it, vi } from "vitest";

const exposed = vi.hoisted(() => ({ api: null as null | { audit: Record<string, unknown> } }));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: { audit: Record<string, unknown> }) => {
      exposed.api = api;
    },
  },
  ipcRenderer: { invoke: vi.fn() },
}));

describe("preload audit api", () => {
  it("exposes only list and listUsers", async () => {
    await import("./index");
    expect(Object.keys(exposed.api!.audit).toSorted()).toEqual(["list", "listUsers"]);
  });
});
