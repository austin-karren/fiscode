import { useEffect, useState } from "react";
import { Button } from "@fiscode/ui/components/button";
import {
  onVaultChange,
  requestVaultPermission,
  vaultPermissionState,
  type VaultPermission,
} from "@fiscode/db";

// ADR 0001 § 11.1. Shown on every page while the picked folder is not granted.
export function VaultReconnectBanner() {
  const [perm, setPerm] = useState<VaultPermission | "unknown">("unknown");

  useEffect(() => {
    let live = true;
    const load = () => {
      void vaultPermissionState().then((next) => {
        if (live) setPerm(next);
      });
    };
    load();
    const off = onVaultChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  if (perm !== "prompt" && perm !== "denied") return null;

  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <span className="flex-1">Reconnect to see your files</span>
      <Button
        size="sm"
        onClick={() => {
          // requestVaultPermission must be the first await, or Chromium drops the gesture.
          void (async () => {
            const next = await requestVaultPermission();
            setPerm(next);
          })();
        }}
      >
        Reconnect
      </Button>
    </div>
  );
}
