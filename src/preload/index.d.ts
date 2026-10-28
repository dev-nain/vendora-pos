import type { VendoraApi } from "@shared/ipc";

declare global {
  interface Window {
    vendora: VendoraApi;
  }
}
