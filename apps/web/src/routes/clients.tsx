import { useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { clientRepo, expenseRepo, incomeRepo, timeRepo } from "@fiscode/db";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Briefcase } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditClientDialog } from "../components/edit-client-dialog";
import { ArchiveDialog, type ArchiveReference } from "../components/archive-dialog";
import { ParentName } from "../components/parent-name";
import { restoreRow, softDeleteWithUndo } from "../lib/soft-delete";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string(),
  defaultRate: z.string(),
});
const fs = clientSchema.shape;

export const Route = createFileRoute("/clients")({
  loader: async () => ({
    // Archived clients too, for the "Show archived" view.
    clients: await clientRepo.listIncludingDeleted(),
    // Rows that can point at a client, to count them in the archive dialog.
    income: await incomeRepo.list(),
    timeEntries: await timeRepo.list(),
    expenses: await expenseRepo.list(),
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const {
    clients: allClients,
    income,
    timeEntries,
    expenses,
  } = useLoaderData({ from: "/clients" });
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = allClients.filter((c) => c.deletedAt).length;
  const clients = allClients.filter((c) => showArchived || !c.deletedAt);

  const referencesTo = (clientId: string): ArchiveReference[] => [
    {
      count: income.filter((r) => r.clientId === clientId).length,
      singular: "income row",
      plural: "income rows",
    },
    {
      count: timeEntries.filter((r) => r.clientId === clientId).length,
      singular: "time entry",
      plural: "time entries",
    },
    {
      count: expenses.filter((r) => r.clientId === clientId).length,
      singular: "expense",
      plural: "expenses",
    },
  ];

  const form = useForm({
    defaultValues: { name: "", type: "", defaultRate: "" },
    validators: { onSubmit: clientSchema },
    onSubmit: async ({ value, formApi }) => {
      await clientRepo.create({
        name: value.name.trim(),
        type: value.type.trim() || null,
        notes: null,
        defaultRateCents: value.defaultRate ? (parseUSD(value.defaultRate) ?? null) : null,
        defaultCommissionRate: null,
        deletedAt: null,
      });
      toast.success("Client added.");
      formApi.reset();
      router.invalidate();
    },
  });

  const archive = (client: (typeof allClients)[number]) =>
    softDeleteWithUndo({
      repo: clientRepo,
      row: client,
      message: `${client.name} archived.`,
      undoneMessage: `${client.name} restored.`,
      onChange: () => router.invalidate(),
    });

  const unarchive = (client: (typeof allClients)[number]) =>
    restoreRow({
      repo: clientRepo,
      row: client,
      message: `${client.name} un-archived.`,
      onChange: () => router.invalidate(),
    });

  return (
    <Page title="Clients" description="Companies you do recurring or one-off work for.">
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Add client
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[2fr_1fr_1fr]">
            <TSFormField form={form} name="name" validators={{ onBlur: fs.name }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="type">
              {(field) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="recurring, consulting"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="defaultRate">
              {(field) => (
                <FormItem>
                  <FormLabel>Default rate</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="$0.00"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          </CardContent>
          <CardFooter className="justify-end">
            <form.Subscribe
              selector={(s) => ({
                canSubmit: s.canSubmit,
                isSubmitting: s.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      <div className="flex flex-col gap-2">
        {archivedCount > 0 ? (
          <div className="flex justify-end">
            <Button
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              Show archived ({archivedCount})
            </Button>
          </div>
        ) : null}
        {clients.length === 0 ? (
          <NoDataEmpty
            icon={Briefcase}
            title="No clients yet"
            description="Add a client so income, time, and expense entries can reference them."
          />
        ) : (
          <DataTable>
            <DataTable.Head>
              <DataTable.Row>
                <DataTable.HeaderCell>Name</DataTable.HeaderCell>
                <DataTable.HeaderCell>Type</DataTable.HeaderCell>
                <DataTable.HeaderCell align="right">Default rate</DataTable.HeaderCell>
                <DataTable.HeaderCell />
              </DataTable.Row>
            </DataTable.Head>
            <DataTable.Body>
              {clients.map((c) => (
                <DataTable.Row key={c.id}>
                  <DataTable.Cell>
                    <ParentName parent={c} />
                  </DataTable.Cell>
                  <DataTable.Cell>{c.type ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    {c.defaultRateCents !== null ? formatUSD(cents(c.defaultRateCents)) : "—"}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    {c.deletedAt ? (
                      <Button variant="ghost" size="sm" onClick={() => unarchive(c)}>
                        Un-archive
                      </Button>
                    ) : (
                      <div className="inline-flex gap-1">
                        <EditClientDialog client={c} onSaved={() => router.invalidate()} />
                        <ArchiveDialog
                          itemName={c.name}
                          references={referencesTo(c.id)}
                          onConfirm={() => archive(c)}
                        />
                      </div>
                    )}
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
            </DataTable.Body>
          </DataTable>
        )}
      </div>
    </Page>
  );
}
