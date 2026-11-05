import "@fontsource/noto-nastaliq-urdu/400.css";
import "@fontsource/noto-nastaliq-urdu/700.css";
import "./receipt-page.css";
import type { ReceiptBlock, ReceiptModel } from "@shared/receipt";

declare global {
  interface Window {
    renderReceipt: (model: ReceiptModel) => Promise<{ heightPx: number }>;
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function barcode(block: Extract<ReceiptBlock, { type: "barcode" }>): HTMLElement {
  const wrapper = document.createElement("div");
  const bars = element("div", "barcode");
  bars.style.width = `${block.modules.length * block.moduleWidthPx}px`;
  bars.style.height = `${block.heightPx}px`;
  let start = -1;
  for (let i = 0; i <= block.modules.length; i++) {
    const bar = block.modules[i] === true;
    if (bar && start < 0) start = i;
    if (!bar && start >= 0) {
      const run = element("div", "bar");
      run.style.left = `${start * block.moduleWidthPx}px`;
      run.style.width = `${(i - start) * block.moduleWidthPx}px`;
      run.style.height = `${block.heightPx}px`;
      bars.append(run);
      start = -1;
    }
  }
  wrapper.append(bars, element("div", "caption", block.caption));
  return wrapper;
}

function build(block: ReceiptBlock): HTMLElement {
  switch (block.type) {
    case "text": {
      const node = element(
        "div",
        `text ${block.align} ${block.size === "title" ? "title" : ""} ${block.weight === "bold" ? "bold" : ""} ${block.lang === "ur" ? "ur" : ""}`,
        block.text,
      );
      if (block.lang === "ur") {
        node.dir = "rtl";
        node.lang = "ur";
      }
      return node;
    }
    case "pair": {
      const node = element(
        "div",
        `pair ${block.size === "title" ? "title" : ""} ${block.weight === "bold" ? "bold" : ""}`,
      );
      node.append(
        element("span", "left-part", block.left),
        element("span", "right-part", block.right),
      );
      return node;
    }
    case "rule":
      return element("div", "rule");
    case "gap": {
      const node = element("div", "gap");
      node.style.height = `${block.heightPx}px`;
      return node;
    }
    case "table": {
      const node = element("div", "table");
      block.header.forEach((cell, i) =>
        node.append(element("div", i === 0 ? "head" : "head num", cell)),
      );
      for (const row of block.rows) {
        row.forEach((cell, i) => node.append(element("div", i === 0 ? "" : "num", cell)));
      }
      return node;
    }
    case "barcode":
      return barcode(block);
  }
}

async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('400 24px "Noto Nastaliq Urdu"', "ء"),
    document.fonts.load('700 24px "Noto Nastaliq Urdu"', "ء"),
  ]);
  await document.fonts.ready;
}

window.renderReceipt = async (model) => {
  const root = document.documentElement.style;
  root.setProperty("--body-px", `${model.metrics.bodyPx}px`);
  root.setProperty("--title-px", `${model.metrics.titlePx}px`);
  root.setProperty("--latin-line", String(model.metrics.latinLineHeight));
  root.setProperty("--urdu-line", String(model.metrics.urduLineHeight));
  document.body.style.width = `${model.widthPx}px`;

  const container = document.getElementById("receipt");
  if (!container) throw new Error("Receipt root is missing");
  container.replaceChildren(...model.blocks.map(build));
  await loadFonts();
  return { heightPx: Math.ceil(document.body.getBoundingClientRect().height) };
};
