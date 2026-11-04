import { connect } from "node:net";
import type { PrintResult } from "../../shared/receipt";
import { printOffline, printSucceeded } from "./print-result";
import type { PrinterTransport } from "./printer-transport";

const defaultTimeoutMs = 3000;

export function createNetworkTransport(
  host: string,
  port: number,
  timeoutMs = defaultTimeoutMs,
): PrinterTransport {
  return {
    send: ({ bytes }) =>
      new Promise<PrintResult>((resolve) => {
        let failed = false;
        const socket = connect({ host, port });
        socket.setTimeout(timeoutMs);
        const fail = () => {
          failed = true;
          socket.destroy();
          resolve(printOffline);
        };
        socket.on("timeout", fail);
        socket.on("error", fail);
        socket.on("connect", () => {
          socket.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        });
        socket.on("close", () => {
          if (!failed) resolve(printSucceeded);
        });
      }),
  };
}
