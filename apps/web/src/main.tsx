import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { boot } from "@fiscode/db";

import { router } from "./router";
import {
  hydrateOverlayFromCache,
  shouldSyncInBackground,
  syncTaxYearDataSilently,
  yearsToTrack,
} from "./lib/tax-sync";

// Boot the local DB before rendering so route loaders can read synchronously.
// Local SQLocal boot is fast (~50ms); we deliberately do not show a spinner.
boot().then(async () => {
  // Hydrate the in-memory tax-config overlay from the on-disk cache before
  // the first render so estimates use the freshest numbers we have.
  await hydrateOverlayFromCache();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );

  // Fire-and-forget background sync — failures are logged at debug level
  // only. Errors surface visibly only on the /tax-data settings page.
  const candidates = await Promise.all(
    yearsToTrack().map(async (y) => ((await shouldSyncInBackground(y)) ? y : undefined)),
  );
  const stale = candidates.filter((y): y is number => y !== undefined);
  if (stale.length > 0) {
    void syncTaxYearDataSilently(stale);
  }
});
