import { useState } from "react";
import { createFileRoute, useLoaderData, useLocation, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { documentLinkRepo, clientRepo, expenseRepo, incomeRepo, timeRepo } from "@fiscode/db";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Briefcase } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AttachDialog } from "../components/documents/attach-dialog";
import { rowAnchor } from "../lib/documents-links";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditClientDialog } from "../components/edit-client-dialog";
import { ArchiveDialog, type ArchiveReference } from "../components/archive-dialog";
import { ParentName } from "../components/parent-name";
import { optionalMoneyAmount } from "../lib/field-schemas";
import { restoreRow, softDeleteWithUndo } from "../lib/soft-delete";
import { SectionTitle } from "../components/section-title";
import { recordLabel } from "../lib/record-label";
import { submitForm } from "../lib/submit-form";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string(),
  defaultRate: optionalMoneyAmount,
});
const fs = clientSchema.shape;

export const Route = createFileRoute("/clients")({
  loader: async () => {
    const all = await clientRepo.listIncludingDeleted();
    return {
      // Archived clients too, for the "Show archived" view.
      clients: all,
      // Live rows' documents, in one query for the screen.
      linkCounts: await documentLinkRepo.countsFor(
        "client",
        all.filter((r) => !r.deletedAt).map((r) => r.id),
      ),
      // Rows that can point at a client, to count them in the archive dialog.
      income: await incomeRepo.list(),
      timeEntries: await timeRepo.list(),
      expenses: await expenseRepo.list(),
    };
  },
  component: ClientsPage,
});

function ClientsPage() {
  const {
    clients: allClients,
    linkCounts,
    income,
    timeEntries,
    expenses,
  } = useLoaderData({ from: "/clients" });
  const router = useRouter();
  const hash = useLocation({ select: (l) => l.hash });
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
        defaultRateCents: optionalMoneyAmount.parse(value.defaultRate),
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
          void submitForm(form);
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Add client</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[2fr_1fr_1fr]">
            <TSFormField
              form={form}
              name="name"
              requirement="required"
              validators={{ onBlur: fs.name }}
            >
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
            <TSFormField form={form} name="type" requirement="optional">
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
            <TSFormField
              form={form}
              name="defaultRate"
              requirement="optional"
              validators={{ onBlur: fs.defaultRate }}
            >
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
                isSubmitting: s.isSubmitting,
              })}
            >
              {({ isSubmitting }) => (
                <Button type="submit" disabled={isSubmitting}>
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
            title={archivedCount > 0 ? "No active clients" : "No clients yet"}
            description={
              archivedCount > 0
                ? "Every client is archived. Use “Show archived” above to see or un-archive them, or add a new client."
                : "Add a client so income, time, and expense entries can reference them."
            }
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
                <DataTable.Row
                  key={c.id}
                  id={rowAnchor(c.id)}
                  highlighted={hash === rowAnchor(c.id)}
                >
                  <DataTable.Cell label="Name">
                    <ParentName parent={c} />
                  </DataTable.Cell>
                  <DataTable.Cell label="Type">{c.type ?? "—"}</DataTable.Cell>
                  <DataTable.Cell label="Default rate" align="right">
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
                        <AttachDialog
                          recordType="client"
                          recordId={c.id}
                          recordDate={""}
                          recordLabel={recordLabel.client(c)}
                          count={linkCounts[c.id] ?? 0}
                          onChanged={() => router.invalidate()}
                        />
                        <ArchiveDialog
                          itemName={c.name}
                          recordName={recordLabel.client(c)}
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
