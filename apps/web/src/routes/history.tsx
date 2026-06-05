import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { historyRepo } from "@fiscode/db";
import { History as HistoryIcon } from "lucide-react";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { NoDataEmpty } from "../components/empty-states/no-data";

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
      {history.length === 0 ? (
        <NoDataEmpty
          icon={HistoryIcon}
          title="No history yet"
          description="Mutations show up here in order. Every create / update / delete / revert lands as one row."
        />
      ) : (
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
            {history
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
              ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
