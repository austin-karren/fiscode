import { useState } from "react";
import { Button } from "@fiscode/ui/components/button";
import { resumeVaultMigration } from "@fiscode/db";

import { useVaultMigration, vaultReadOnlyReason } from "../lib/vault-migration";

// The vault migration's banner (ADR 0001 § 10, § 11.3): progress while it runs, the reason and
// Resume after it stopped part way, nothing once it is done.
export function VaultMigrationBanner() {
  const state = useVaultMigration();
  const [resuming, setResuming] = useState(false);
  if (state.phase === "migrating") {
    return (
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm"
      >
        <span>
          Moving your files into the vault
          {state.total > 0 ? `: ${state.done} of ${state.total}` : "…"}
        </span>
        {state.total > 0 ? (
          <progress
            className="h-1.5 min-w-24 flex-1 accent-primary"
            max={state.total}
            value={state.done}
            aria-label="Files moved"
          />
        ) : null}
      </div>
    );
  }
  if (state.phase === "migration-incomplete") {
    return (
      <div
        role="alert"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
      >
        <span className="grid flex-1 gap-0.5">
          <span>{vaultReadOnlyReason(state)}</span>
          {/* Why it stopped: the job's own error, or that it was cancelled. */}
          <span className="text-muted-foreground">{state.message}</span>
        </span>
        <Button
          size="sm"
          disabled={resuming}
          onClick={async () => {
            setResuming(true);
            try {
              await resumeVaultMigration();
            } finally {
              setResuming(false);
            }
          }}
        >
          Resume
        </Button>
      </div>
    );
  }
  return null;
}
