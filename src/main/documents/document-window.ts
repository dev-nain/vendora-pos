import { join } from "node:path";
import { BrowserWindow } from "electron";
import type { DocumentModel } from "../../shared/document";

export type DocumentPrintOutcome = "printed" | "cancelled" | "failed";

export interface DocumentRenderer {
  toPdf(model: DocumentModel): Promise<Buffer>;
  print(model: DocumentModel): Promise<DocumentPrintOutcome>;
}

async function openRendered(model: DocumentModel): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());

    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    await (devUrl
      ? window.loadURL(`${devUrl}/document.html`)
      : window.loadFile(join(__dirname, "../renderer/document.html")));
    await window.webContents.executeJavaScript(`window.renderDocument(${JSON.stringify(model)})`);
    return window;
  } catch (error) {
    window.destroy();
    throw error;
  }
}

export function createDocumentRenderer(): DocumentRenderer {
  return {
    async toPdf(model) {
      const window = await openRendered(model);
      try {
        return await window.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        });
      } finally {
        window.destroy();
      }
    },
    async print(model) {
      const window = await openRendered(model);
      try {
        return await new Promise<DocumentPrintOutcome>((resolve) => {
          window.webContents.print(
            { silent: false, printBackground: true, pageSize: "A4" },
            (success, reason) => {
              if (success) resolve("printed");
              else resolve(/cancel/i.test(reason) ? "cancelled" : "failed");
            },
          );
        });
      } finally {
        window.destroy();
      }
    },
  };
}
