import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { clientRepo, incomeRepo, profileRepo } from "@fiscode/db";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditIncomeDialog } from "../components/edit-income-dialog";
import { ParentName } from "../components/parent-name";
import { moneyAmount } from "../lib/field-schemas";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { useToday } from "../lib/use-today";
import { formatDate } from "../lib/format-date";
import { INCOME_KIND_LABELS, labelFor } from "@fiscode/core";

const KIND_OPTIONS = [
  { value: "recurring", label: "Recurring" },
  { value: "bonus", label: "Bonus" },
  { value: "consulting", label: "Consulting" },
  { value: "other", label: "Other" },
];

// Per-field schemas fire on blur; the form-level schema fires on submit.
const fieldSchemas = {
  date: z.date({ message: "Pick a date" }),
  amount: moneyAmount,
  clientId: z.string(),
  kind: z.enum(["recurring", "bonus", "consulting", "other"], {
    message: "Pick an income kind",
  }),
  description: z.string(),
};
const incomeFormSchema = z.object(fieldSchemas);

export const Route = createFileRoute("/income")({
  loader: async () => ({
    income: await incomeRepo.list(),
    // Archived clients too: old rows keep showing their client's name.
    clients: await clientRepo.listIncludingDeleted(),
    profile: await profileRepo.get(),
  }),
  component: IncomePage,
});

function IncomePage() {
  const { income, clients: allClients, profile } = useLoaderData({ from: "/income" });
  const router = useRouter();
  // Only live clients can be picked for a new entry.
  const clients = allClients.filter((c) => !c.deletedAt);

  const today = useToday();
  const form = useForm({
    defaultValues: {
      date: today as Date | undefined,
      amount: "",
      clientId: "",
      kind: "recurring",
      description: "",
    },
    validators: { onSubmit: incomeFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const parsed = moneyAmount.parse(value.amount);
      await incomeRepo.create({
        date: dateToIso(value.date!),
        amountCents: parsed,
        clientId: value.clientId || null,
        sourceType: "1099",
        kind: value.kind,
        description: value.description || null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Income entry added.");
      formApi.reset();
      router.invalidate();
    },
  });

  const remove = (row: (typeof income)[number]) =>
    softDeleteWithUndo({
      repo: incomeRepo,
      row,
      message: "Income entry deleted.",
      undoneMessage: "Income entry restored.",
      onChange: () => router.invalidate(),
    });

  return (
    <Page
      title="Income"
      description="All 1099 income entries. Add bonuses and one-offs the same way as recurring."
    >
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Add entry
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.2fr_1fr_2fr]">
            <TSFormField form={form} name="date" validators={{ onBlur: fieldSchemas.date }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="amount" validators={{ onBlur: fieldSchemas.amount }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
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
            <TSFormField form={form} name="clientId">
              {(field) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
                      items={[
                        { value: "__none__", label: "—" },
                        ...clients.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="kind">
              {(field) => (
                <FormItem>
                  <FormLabel>Kind</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={KIND_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="description">
              {(field) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
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

      {income.length === 0 ? (
        <NoDataEmpty
          icon={Coins}
          title="No income entries yet"
          description="Add a 1099 entry above to start tracking your year. Bonuses and one-off consulting income use the same form."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Date</DataTable.HeaderCell>
              <DataTable.HeaderCell>Client</DataTable.HeaderCell>
              <DataTable.HeaderCell>Kind</DataTable.HeaderCell>
              <DataTable.HeaderCell>Description</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {income
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((i) => (
                <DataTable.Row key={i.id}>
                  <DataTable.Cell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap">{formatDate(i.date)}</span>
                      <PreSeStartBadge rowDate={i.date} seStartDate={profile?.seStartDate} />
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>
                    <ParentName parent={allClients.find((c) => c.id === i.clientId)} />
                  </DataTable.Cell>
                  <DataTable.Cell>{labelFor(INCOME_KIND_LABELS, i.kind)}</DataTable.Cell>
                  <DataTable.Cell>{i.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatUSD(cents(i.amountCents))}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditIncomeDialog
                        income={i}
                        clients={allClients}
                        onSaved={() => router.invalidate()}
                      />
                      <Button variant="ghost" size="sm" onClick={() => remove(i)}>
                        Delete
                      </Button>
                    </div>
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
