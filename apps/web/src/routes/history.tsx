import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Card } from "@fiscode/ui/components/card";
import { historyRepo } from "@fiscode/db";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/history")({
  loader: async () => ({ history: await historyRepo.listAll() }),
  component: HistoryPage,
});

function HistoryPage() {
  const { history } = useLoaderData({ from: "/history" });
  return (
    <Page
      title="History"
      description="Every mutation is recorded. Nothing is hard-deleted without explicit confirmation."
    >
      <Card className="p-0">
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>When</DataTable.HeaderCell>
              <DataTable.HeaderCell>Entity</DataTable.HeaderCell>
              <DataTable.HeaderCell>Op</DataTable.HeaderCell>
              <DataTable.HeaderCell>Id</DataTable.HeaderCell>
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {history.length === 0 ? (
              <DataTable.Empty message="No history yet." />
            ) : (
              history
                .slice()
                .reverse()
                .map((h) => (
                  <DataTable.Row key={h.id}>
                    <DataTable.Cell>
                      <span className="font-mono text-xs">{h.at}</span>
                    </DataTable.Cell>
                    <DataTable.Cell>{h.entity}</DataTable.Cell>
                    <DataTable.Cell>{h.op}</DataTable.Cell>
                    <DataTable.Cell>
                      <span className="font-mono text-xs">{h.entityId}</span>
                    </DataTable.Cell>
                  </DataTable.Row>
                ))
            )}
          </DataTable.Body>
        </DataTable>
      </Card>
    </Page>
  );
}
