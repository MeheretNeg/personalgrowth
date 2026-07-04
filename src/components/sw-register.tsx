"use client";

import { useEffect } from "react";

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
  }, []);
  return null;
}
