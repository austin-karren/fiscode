import { toast } from "sonner";

/** The shape of `registerSW` from `virtual:pwa-register`. */
export type RegisterSW = (options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (
    scriptUrl: string,
    registration: Pick<ServiceWorkerRegistration, "waiting"> | undefined,
  ) => void;
}) => (reloadPage?: boolean) => Promise<void>;

/** The part of `navigator.serviceWorker` used here. */
type WorkerContainer = {
  controller: unknown;
  addEventListener: (type: "controllerchange", listener: () => void) => void;
};

/**
 * Registers the service worker. A new deploy is downloaded in the background
 * and then waits: the user sees an "Update available" toast and the new code
 * only takes over when they press Reload, so nothing is swapped under a
 * half-filled form unasked.
 *
 * Reload activates the new worker, and every open tab of the app then reloads
 * (the old worker's cached files are gone, so a tab left on the old code could
 * no longer load its routes). The toast says so.
 *
 * "Later" only dismisses the toast. The update keeps waiting, and every later
 * page load that finds it waiting offers it again.
 */
export function registerServiceWorker(
  registerSW: RegisterSW,
  container: WorkerContainer | undefined = navigator.serviceWorker,
) {
  // A tab that was already served by a worker reloads when a new one takes
  // over, whichever tab asked for it. On a first install nothing controlled
  // the page before, so there is nothing to reload.
  if (container?.controller) {
    let reloading = false;
    container.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  const offerUpdate = () => {
    toast("Update available", {
      id: "pwa-update",
      description:
        "Reload to use the new version. This reloads every open fiscode tab, and unsaved form input is lost.",
      duration: Infinity,
      action: { label: "Reload", onClick: () => void applyUpdate(true) },
      cancel: { label: "Later", onClick: () => {} },
    });
  };

  const applyUpdate = registerSW({
    // A new version finished downloading while this page was open.
    onNeedRefresh: offerUpdate,
    // A new version was already waiting when this page loaded: it was put off
    // with "Later", or the page was reloaded with the toast up.
    onRegisteredSW: (_scriptUrl, registration) => {
      if (registration?.waiting) offerUpdate();
    },
    onOfflineReady: () => {
      toast("Ready to work offline.", { id: "pwa-offline-ready" });
    },
  });
}
