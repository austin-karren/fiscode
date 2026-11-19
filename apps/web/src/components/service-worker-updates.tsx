/// <reference types="vite-plugin-pwa/client" />
import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";

import { registerServiceWorker } from "../lib/pwa-update";

let registered = false;

/**
 * Registers the service worker once, after mount. Render it after the
 * `<Toaster />`: an update that is already waiting is reported within
 * milliseconds, and a toast raised before the Toaster has mounted is never
 * shown.
 */
export function ServiceWorkerUpdates() {
  useEffect(() => {
    // StrictMode runs effects twice in development.
    if (registered) return;
    registered = true;
    registerServiceWorker(registerSW);
  }, []);
  return null;
}
