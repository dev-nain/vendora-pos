import { useCallback, useEffect, useRef, useState } from "react";

import type { BarcodeLookup } from "@shared/products";
import { isSessionError, serviceErrorMessage } from "../auth/messages";
import { createBurstDetector, restoreField } from "../billing/scan-burst";
import { notFoundMessage } from "../billing/scan-input";
import { createScanQueue, type ScanQueue } from "../billing/scan-queue";
import { playScanError, playScanOk } from "../billing/scan-sounds";

const NOTICE_MS = 4000;

interface LineScannerOptions {
  enabled: boolean;
  paused: boolean;
  onLookup: (lookup: BarcodeLookup) => Promise<string | null>;
  onSessionEnded: () => void;
}

export function useLineScanner({ enabled, paused, onLookup, onSessionEnded }: LineScannerOptions) {
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<ScanQueue | null>(null);
  const processScan = useRef<(code: string) => Promise<"continue">>(async () => "continue");

  const clearNotice = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    queue.current = createScanQueue((code) => processScan.current(code));
  }, []);

  useEffect(() => {
    processScan.current = async (code) => {
      clearNotice();
      try {
        const lookup = await window.vendora.products.lookupBarcode(code);
        if (lookup === null) {
          showNotice(notFoundMessage(code));
          playScanError();
        } else {
          const message = await onLookup(lookup);
          if (message === null) {
            playScanOk();
          } else {
            showNotice(message);
            playScanError();
          }
        }
      } catch (cause) {
        if (isSessionError(cause)) onSessionEnded();
        else showNotice(serviceErrorMessage);
      }
      return "continue";
    };
  }, [onLookup, clearNotice, showNotice, onSessionEnded]);

  useEffect(() => {
    if (paused) queue.current?.pause();
    else queue.current?.resume();
  }, [paused]);

  useEffect(() => {
    if (!enabled || paused) return;
    const detector = createBurstDetector();
    let snapshot: { field: HTMLInputElement; value: string } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.id === "scan-field") {
        detector.reset();
        return;
      }
      const result = detector.feed(event.key, event.timeStamp);
      const field = document.activeElement;
      if (result.startedBurst && field instanceof HTMLInputElement) {
        snapshot = { field, value: field.value };
      }
      if (result.scan === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (snapshot) restoreField(snapshot.field, snapshot.value);
      queue.current?.enqueue(result.scan);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, paused]);

  const enqueue = useCallback((code: string) => queue.current?.enqueue(code), []);

  return { notice, showNotice, clearNotice, enqueue };
}
