import { createFileRoute, Link } from "@tanstack/react-router";
import { readLastScanReport, readVaultMigrationReport } from "@fiscode/db";
import { ArrowLeft } from "lucide-react";

import { Page } from "../components/page";
import { CheckPage } from "../components/vault-check/check-page";
import { useFocusScan } from "../lib/focus-scan";

// /documents/check (ADR 0001 § 6, § 11.4): a page of its own, beside Documents, not inside it.
export const Route = createFileRoute("/documents_/check")({
  loader: async () => {
    const [report, migration] = await Promise.all([
      readLastScanReport(),
      readVaultMigrationReport(),
    ]);
    return { report, migration };
  },
  component: CheckRoute,
});

function CheckRoute() {
  const { report, migration } = Route.useLoaderData();
  useFocusScan();
  return (
    <Page
      title="Check folder"
      description="Your vault folder compared with fiscode's records."
      actions={
        <Link
          to="/documents"
          className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Documents
        </Link>
      }
    >
      <CheckPage report={report} migration={migration} />
    </Page>
  );
}
