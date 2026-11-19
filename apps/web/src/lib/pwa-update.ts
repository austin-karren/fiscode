import { toast } from "sonner";

/** The shape of `registerSW` from `virtual:pwa-register`. */
export type RegisterSW = (options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
 * Registers the service worker. A new deploy is downloaded in the background
 * and then waits: the user sees an "Update available" toast and the new code
 * only takes over when they press Reload, so a half-filled form is not lost.
 */
export function registerServiceWorker(registerSW: RegisterSW) {
  const applyUpdate = registerSW({
    onNeedRefresh: () => {
      toast("Update available", {
        id: "pwa-update",
        description: "Reload to use the new version. Unsaved form input will be lost.",
        duration: Infinity,
        action: { label: "Reload", onClick: () => void applyUpdate(true) },
      });
    },
    onOfflineReady: () => {
      toast("Ready to work offline.", { id: "pwa-offline-ready" });
    },
  });
}
