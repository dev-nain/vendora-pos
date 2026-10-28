import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("vendora", {});
