import { join } from "node:path";
import { BrowserWindow, nativeTheme, session } from "electron";

const TITLE_BAR_HEIGHT = 44;

function chromeColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#202020", symbolColor: "#FFFFFF" }
    : { color: "#F3F3F3", symbolColor: "#1A1A1A" };
}

export function createMainWindow(): BrowserWindow {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1366,
    minHeight: 768,
    show: false,
    backgroundColor: chromeColors().color,
    titleBarStyle: "hidden",
    titleBarOverlay: { height: TITLE_BAR_HEIGHT, ...chromeColors() },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (!process.env["ELECTRON_RENDERER_URL"]) {
    window.removeMenu();
  }

  const syncChrome = () => {
    window.setBackgroundColor(chromeColors().color);
    window.setTitleBarOverlay({ height: TITLE_BAR_HEIGHT, ...chromeColors() });
  };
  nativeTheme.on("updated", syncChrome);
  window.once("closed", () => nativeTheme.off("updated", syncChrome));

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
