import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, outDir, shotsFile] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) waiter.reject(new Error(msg.error.message));
  else waiter.resolve(msg.result);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 800));

const lines = readFileSync(shotsFile, "utf8").split("\n");
for (const line of lines) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [name, route = "/", size = "1366x768", theme = "light"] = line.split("|");
  const [width, height] = size.split("x").map(Number);

  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await send("Runtime.evaluate", {
    expression: `location.hash = ${JSON.stringify(route === "/" ? "" : route)}`,
  });
  await settle();

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(file);
}

await send("Browser.close").catch(() => {});
ws.close();
