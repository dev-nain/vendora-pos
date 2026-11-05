import { printerMessages, type PrintResult } from "../../shared/receipt";

export const printSucceeded: PrintResult = { successful: true, canRetry: false, message: "" };

export const printOffline: PrintResult = {
  successful: false,
  canRetry: true,
  message: printerMessages.offline,
};

export const printerNotFound: PrintResult = {
  successful: false,
  canRetry: false,
  message: printerMessages.notFound,
};
