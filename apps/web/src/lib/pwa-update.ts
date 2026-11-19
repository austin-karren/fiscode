import { toast } from "sonner";

/** The shape of `registerSW` from `virtual:pwa-register`. */
export type RegisterSW = (options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
 * Registers the service worker. A new deploy is downloaded in the background
 * and then waits: the user sees an "Update available" toast and the new code
 * only takes over when they press Reload, so nothing is swapped under a
 * half-filled form unasked.
 *
 * Reload activates the new worker, and every open tab of the app then reloads
 * (the old worker's cached files are gone, so a tab left on the old code could
 * no longer load its routes). The toast says so.
 */
export function registerServiceWorker(registerSW: RegisterSW) {
  const applyUpdate = registerSW({
    onNeedRefresh: () => {
      toast("Update available", {
        id: "pwa-update",
        description:
          "Reload to use the new version. This reloads every open fiscode tab, and unsaved form input is lost.",
        duration: Infinity,
        action: { label: "Reload", onClick: () => void applyUpdate(true) },
        // Dismisses the toast. The new version keeps waiting and the toast
        // comes back on the next page load.
        cancel: { label: "Later", onClick: () => {} },
      });
    },
    onOfflineReady: () => {
      toast("Ready to work offline.", { id: "pwa-offline-ready" });
    },
  });
}
