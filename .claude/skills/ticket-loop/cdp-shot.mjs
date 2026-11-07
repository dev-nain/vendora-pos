import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [port, outDir, shotsFile, saveDir] = process.argv.slice(2);

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

const waitForFile = async (file) => {
  let lastSize = -1;
  for (let i = 0; i < 75; i++) {
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? -1;
    if (size > 0 && size === lastSize) return;
    lastSize = size;
    await wait(200);
  }
  throw new Error(`pdf=${file}: not written within 15 s`);
};

const rasterisePdf = async (fileName, name, width, height) => {
  if (!saveDir) throw new Error("pdf= needs the save folder from screenshots.sh");
  const pdf = join(saveDir, fileName);
  await waitForFile(pdf);
  const base = join(outDir, name);
  const result = spawnSync("pdftoppm", [
    "-png", "-f", "1", "-l", "1", "-singlefile",
    "-scale-to-x", String(width), "-scale-to-y", String(height), pdf, base,
  ]);
  if (result.error?.code === "ENOENT") throw new Error("pdf= needs pdftoppm (poppler-utils)");
  if (result.status !== 0) throw new Error(`pdftoppm failed: ${result.stderr}`);
  return `${base}.png`;
};

let saleSeeded = false;

const seedSale = async () => {
  if (saleSeeded) return;
  saleSeeded = true;
  const failure = await evaluate(`(async () => {
    const api = window.vendora;
    const step = (name, result) => {
      if (result && result.ok === false) throw new Error(name + ": " + (result.message ?? result.reason));
      return result;
    };
    await api.settings.setReceipt({
      name: "Al Noor General Store",
      address: "Shop 12, Main Bazaar, Lahore",
      phone: "042-35761234",
      ntn: "1234567-8",
      strn: "3277876123456",
      headerEn: "Wholesale and retail",
      headerUr: "خوش آمدید",
      footerEn: "Thank you for shopping",
      footerUr: "شکریہ، دوبارہ تشریف لائیں",
    });
    const category = step("categories.create", await api.categories.create("Grocery")).category;
    const taxes = await api.taxCategories.list();
    const standard = taxes.find((t) => t.name === "Standard") ?? taxes[0];
    const exempt = taxes.find((t) => t.name === "Exempt") ?? taxes[1];
    const base = { categoryId: category.id, brand: null, unit: "piece", internalCode: null,
      mrpPaisa: null, pctCode: null, lowStockThresholdMilli: null };
    const tea = step("products.create tea", await api.products.create({
      ...base, nameEn: "Tapal Danedar 190g", nameUr: "ٹپال دانے دار چائے", taxCategoryId: standard.id,
      costPaisa: 38000, salePricePaisa: 45000,
      barcodes: [{ barcode: "8964000100011", packQtyMilli: 1000, salePricePaisa: null }],
    })).product;
    const soap = step("products.create soap", await api.products.create({
      ...base, nameEn: "Lux Soap 98g", nameUr: null, taxCategoryId: exempt.id,
      costPaisa: 9000, salePricePaisa: 12000,
      barcodes: [{ barcode: "8964000100028", packQtyMilli: 1000, salePricePaisa: null }],
    })).product;
    const shift = await api.shifts.state();
    if (shift.status !== "open") step("shifts.open", await api.shifts.open(500000));
    step("checkout.addProduct tea", await api.checkout.addProduct({ productId: tea.id, qtyMilli: 2000 }));
    let bill = step("checkout.addProduct soap", await api.checkout.addProduct({ productId: soap.id, qtyMilli: 1000 })).bill;
    const teaLine = bill.lines.find((l) => l.productId === tea.id);
    bill = step("checkout.updateLine", await api.checkout.updateLine({
      lineId: teaLine.id, discount: { kind: "percent", bps: 1000 },
    })).bill;
    const total = bill.totals.totalPaisa;
    const card = Math.floor(total / 2);
    step("checkout.complete", await api.checkout.complete({
      draftId: bill.id,
      payments: [
        { method: "card", amountPaisa: card, reference: "4321" },
        { method: "cash", amountPaisa: total - card + 5000 },
      ],
      buyer: { name: "Bilal Traders", ntn: "1234567-8", cnic: "35202-1234567-1", phone: "03001234567" },
    }));
    step("checkout.addProduct open bill", await api.checkout.addProduct({ productId: soap.id, qtyMilli: 1000 }));
    return null;
  })()`).then(
    () => null,
    (error) => error,
  );
  if (failure) throw new Error(`fixture=sale: ${failure.message}`);
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
  if (options.fixture !== undefined && options.fixture !== "sale") {
    throw new Error(`fixture=${options.fixture}: unknown fixture`);
  }
  if (options.fixture === "sale" && !options.as) throw new Error("fixture=sale needs as=<user>");
  await signInAs(options.as);
  if (options.fixture === "sale" && !saleSeeded) {
    await seedSale();
    await reload();
  }
  await evaluate(`location.hash = ${JSON.stringify(route === "/" ? "" : route)}`);
  await settle();
  if (options.js) {
    await evaluate(options.js);
    await settle();
  }

  if (options.pdf) {
    console.log(await rasterisePdf(options.pdf, name, width, height));
    continue;
  }

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(file);
}

// A page target never answers Browser.close, which left the await unsettled and
// exited 13; screenshots.sh kills Electron's process group instead.
ws.close();
