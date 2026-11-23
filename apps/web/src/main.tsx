import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { boot, prepareVault, runVaultStartup } from "@fiscode/db";
import { ThemeProvider } from "@fiscode/ui/components/theme";

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
  // Documents is read-only from the first paint while the vault migration is still to run
  // (ADR 0001 § 10); the job itself, and journal recovery, run in the background below.
  await prepareVault();
  void runVaultStartup();

  // Hydrate the in-memory tax-config overlay from the on-disk cache before
  // the first render so estimates use the freshest numbers we have.
  await hydrateOverlayFromCache();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
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
