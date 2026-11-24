import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { scanVault } from "@fiscode/db";

/** How long the window must stay focused before a focus scan runs (ADR § 11.4: debounced). */
export const FOCUS_SCAN_DELAY_MS = 1500;

/**
 * Runs a focus scan (ADR 0001 § 11.4) when the window comes back into focus, debounced, then
 * re-runs the loaders so the page re-reads the last report for its badge. A focus scan is skipped,
 * never queued, when another tab holds the vault; its errors only cost this badge update.
 */
export function useFocusScan() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        scanVault({ trigger: "focus" })
          .then((r) => {
            if (live && r.status === "done") void router.invalidate();
          })
          .catch((err: unknown) => console.warn("focus scan", err));
      }, FOCUS_SCAN_DELAY_MS);
    };
    const cancel = () => clearTimeout(timer);
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", cancel);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", cancel);
    };
  }, [router]);
}
