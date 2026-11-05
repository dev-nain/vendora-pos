import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
import type { ReceiptModel } from "../../shared/receipt";

export interface CapturedBitmap {
  bitmap: Uint8Array;
  widthPx: number;
  heightPx: number;
}

export interface RenderWindow {
  warm(): Promise<void>;
  capture(model: ReceiptModel): Promise<CapturedBitmap>;
}

const initialHeightPx = 800;

function createHiddenWindow(): { window: BrowserWindow; loaded: Promise<void> } {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: 576,
    height: initialHeightPx,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const loaded = devUrl
    ? window.loadURL(`${devUrl}/receipt.html`)
    : window.loadFile(join(__dirname, "../renderer/receipt.html"));
  return { window, loaded };
}

export function createRenderWindow(): RenderWindow {
  let current: Promise<BrowserWindow> | null = null;

  function acquire(): Promise<BrowserWindow> {
    if (current) return current;
    const { window, loaded } = createHiddenWindow();
    const reset = () => {
      current = null;
    };
    window.webContents.once("render-process-gone", () => {
      reset();
      if (!window.isDestroyed()) window.destroy();
    });
    window.once("closed", reset);
    const ready = loaded.then(() => window);
    ready.catch(reset);
    current = ready;
    return ready;
  }

  return {
    async warm() {
      await acquire();
    },
    async capture(model) {
      const window = await acquire();
      const { webContents } = window;
      const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
      webContents.setZoomFactor(1 / scaleFactor);

      window.setContentSize(model.widthPx, initialHeightPx);
      const { heightPx } = (await webContents.executeJavaScript(
        `window.renderReceipt(${JSON.stringify(model)})`,
      )) as { heightPx: number };
      window.setContentSize(model.widthPx, heightPx);

      const image = await webContents.capturePage({
        x: 0,
        y: 0,
        width: model.widthPx,
        height: heightPx,
      });
      const size = image.getSize();
      if (size.width !== model.widthPx) {
        throw new Error(`Receipt rendered ${size.width} px wide, expected ${model.widthPx}`);
      }
      return { bitmap: image.toBitmap(), widthPx: size.width, heightPx: size.height };
    },
  };
}
