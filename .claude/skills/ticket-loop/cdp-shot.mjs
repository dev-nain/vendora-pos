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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(800);

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value;
};

const reload = async () => {
  await send("Page.reload");
  for (let i = 0; i < 50; i++) {
    await wait(200);
    const ready = await evaluate("document.readyState").catch(() => null);
    if (ready === "complete") return;
  }
  throw new Error("app did not reload");
};

// Passwords stay in the dev fixture file, never in shot lines or plans.
const fixturePasswords = () => {
  const source = readFileSync("src/main/db/dev-users.ts", "utf8");
  const pairs = source.matchAll(/username:\s*"([^"]+)",\s*password:\s*"([^"]+)"/g);
  return new Map([...pairs].map(([, username, password]) => [username, password]));
};

const signInAs = async (username) => {
  const current = await evaluate("window.vendora.auth.current().then((u) => u?.username ?? null)");
  if (current === (username ?? null)) return;
  if (current) await evaluate("window.vendora.auth.logout()");
  if (username) {
    const password = fixturePasswords().get(username);
    if (!password) throw new Error(`as=${username}: no such user in src/main/db/dev-users.ts`);
    const result = await evaluate(
      `window.vendora.auth.login(${JSON.stringify(username)}, ${JSON.stringify(password)})`,
    );
    if (!result?.ok) throw new Error(`as=${username}: login failed (${result?.message})`);
  }
  await reload();
};

const lines = readFileSync(shotsFile, "utf8").split("\n");
for (const line of lines) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [name, route = "/", size = "1366x768", theme = "light", ...extra] = line.split("|");
  const [width, height] = size.split("x").map(Number);
  const options = Object.fromEntries(
    extra.map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]),
  );

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
  await signInAs(options.as);
  await evaluate(`location.hash = ${JSON.stringify(route === "/" ? "" : route)}`);
  await settle();
  if (options.js) {
    await evaluate(options.js);
    await settle();
  }

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(file);
}

// A page target never answers Browser.close, which left the await unsettled and
// exited 13; screenshots.sh kills Electron's process group instead.
ws.close();
