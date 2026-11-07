import "@fontsource/noto-nastaliq-urdu/400.css";
import "@fontsource/noto-nastaliq-urdu/700.css";
import "./document-page.css";
import type { DocumentModel, DocumentPair } from "@shared/document";

declare global {
  interface Window {
    renderDocument: (model: DocumentModel) => Promise<void>;
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pair(className: string, { label, value }: DocumentPair): HTMLElement {
  const node = element("div", className);
  node.append(element("span", "label", `${label}: `), element("span", "", value));
  return node;
}

function build(model: DocumentModel): HTMLElement[] {
  const head = element("div", "head");
  head.append(element("h1", "title", model.title), element("div", "reference", model.reference));

  const panels = element("div", "panels");
  for (const panel of model.panels) {
    const node = element("div", "panel");
    if (panel.label) node.append(element("div", "label", panel.label));
    for (const line of panel.lines) node.append(element("div", "", line));
    panels.append(node);
  }

  const facts = element("div", "facts");
  facts.append(...model.facts.map((fact) => pair("fact", fact)));

  const headRow = element("tr", "");
  for (const column of model.columns) {
    const th = element("th", column.align === "right" ? "right" : "", column.label);
    if (column.width) th.style.width = column.width;
    headRow.append(th);
  }
  const thead = element("thead", "");
  thead.append(headRow);
  const tbody = element("tbody", "");
  for (const row of model.rows) {
    const tr = element("tr", "");
    row.forEach((cell, index) => {
      const td = element("td", model.columns[index]?.align === "right" ? "right" : "");
      td.append(element("div", "", cell.text));
      if (cell.urdu) {
        const urdu = element("div", "ur", cell.urdu);
        urdu.dir = "rtl";
        urdu.lang = "ur";
        td.append(urdu);
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
  const table = element("table", "");
  table.append(thead, tbody);

  const totals = element("div", "totals");
  for (const total of model.totals) {
    const row = element("div", "total");
    row.append(element("span", "", total.label), element("span", "", total.value));
    totals.append(row);
  }

  const nodes = [head, panels, facts, table, totals];
  if (model.notes) {
    const notes = element("div", "notes");
    notes.append(element("div", "label", "Notes"), element("div", "body", model.notes));
    nodes.push(notes);
  }
  return nodes;
}

async function loadFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load('400 24px "Noto Nastaliq Urdu"', "ء"),
    document.fonts.load('700 24px "Noto Nastaliq Urdu"', "ء"),
  ]);
  await document.fonts.ready;
}

window.renderDocument = async (model) => {
  const container = document.getElementById("document");
  if (!container) throw new Error("Document root is missing");
  document.title = `${model.title} ${model.reference}`;
  container.replaceChildren(...build(model));
  await loadFonts();
};
