"use client";

import { useEffect } from "react";
import { requestPersistentStorage } from "@/lib/store";

/** Registers the service worker (notification display + offline shell). */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {
          /* unsupported/blocked — in-page cues and vibration still work */
        });
    }
    // Ask the browser not to evict the irreplaceable training record.
    requestPersistentStorage();
  }, []);
  return null;
}
