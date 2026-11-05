import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { printerMessages } from "../../shared/receipt";
import { createNetworkTransport } from "./network-printer";

describe("createNetworkTransport", () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  const listen = (server: Server) =>
    new Promise<number>((resolve) => {
      servers.push(server);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });

  it("delivers every byte and succeeds", async () => {
    const received: Uint8Array[] = [];
    const done = new Promise<void>((resolve) => {
      const server = createServer((socket) => {
        socket.on("data", (chunk: Buffer) => received.push(chunk));
        socket.on("end", resolve);
      });
      void listen(server).then((port) => {
        void createNetworkTransport("127.0.0.1", port)
          .send({ kind: "receipt", bytes: Uint8Array.of(1, 2, 3, 4) })
          .then((result) => {
            expect(result).toEqual({ successful: true, canRetry: false, message: "" });
          });
      });
    });

    await done;

    expect(Buffer.concat(received).toJSON().data).toEqual([1, 2, 3, 4]);
  });

  it("fails with a retryable offline message when the connection is refused", async () => {
    const server = createServer();
    const port = await listen(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const result = await createNetworkTransport("127.0.0.1", port).send({
      kind: "receipt",
      bytes: Uint8Array.of(1),
    });

    expect(result).toEqual({
      successful: false,
      canRetry: true,
      message: printerMessages.offline,
    });
  });

  it("times out when the printer stops reading", async () => {
    const port = await listen(createServer({ pauseOnConnect: true }));

    const result = await createNetworkTransport("127.0.0.1", port, 150).send({
      kind: "receipt",
      bytes: new Uint8Array(64 * 1024 * 1024),
    });

    expect(result.successful).toBe(false);
    expect(result.canRetry).toBe(true);
  });
});
