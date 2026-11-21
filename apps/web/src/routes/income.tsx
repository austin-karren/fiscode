import { useRef } from "react";
import { createFileRoute, useLoaderData, useLocation, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { clientRepo, incomeRepo, profileRepo, documentLinkRepo } from "@fiscode/db";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Coins } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { AttachDialog } from "../components/documents/attach-dialog";
import { rowAnchor } from "../lib/documents-links";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { DatePicker, dateToIso, isoToDate } from "../components/forms/date-picker";
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
import { SectionTitle } from "../components/section-title";
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { recordLabel } from "../lib/record-label";

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
  loader: async () => {
    const incomeRows = await incomeRepo.list();
    return {
      income: incomeRows,
      // Documents per row, in one query for the screen.
      linkCounts: await documentLinkRepo.countsFor(
        "income",
        incomeRows.map((r) => r.id),
      ),
      // Archived clients too: old rows keep showing their client's name.
      clients: await clientRepo.listIncludingDeleted(),
      profile: await profileRepo.get(),
    };
  },
  component: IncomePage,
});

function IncomePage() {
  const { income, clients: allClients, profile, linkCounts } = useLoaderData({ from: "/income" });
  const hash = useLocation({ select: (l) => l.hash });
  const router = useRouter();
  // Only live clients can be picked for a new entry.
  const clients = allClients.filter((c) => !c.deletedAt);

  const today = useToday();
  const empty = {
    date: today as Date | undefined,
    amount: "",
    clientId: "",
    kind: "recurring",
    description: "",
  };
  // The add card, and its Amount: focus targets after Add and Duplicate.
  const addCard = useRef<HTMLDivElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: empty,
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
      // A run of entries (a year of monthly income) shares the date, the client
      // and the kind: keep those, clear the rest, and go on with the amount.
      formApi.reset(
        { ...empty, date: value.date, clientId: value.clientId, kind: value.kind },
        { keepDefaultValues: true },
      );
      router.invalidate();
      amountInput.current?.focus();
    },
  });

  // Fills the add form with a row's values, and puts focus on its date, the
  // value a copy most often changes. An archived client cannot be picked for
  // a new entry, so it is left out.
  const duplicate = (row: (typeof income)[number]) => {
    form.reset(
      {
        date: isoToDate(row.date) ?? today,
        amount: formatUSD(cents(row.amountCents)).replace(/[$,]/g, ""),
        clientId: clients.some((c) => c.id === row.clientId) ? (row.clientId ?? "") : "",
        kind: row.kind,
        description: row.description ?? "",
      },
      { keepDefaultValues: true },
    );
    // The first form control is the date field's trigger; FormControl gives each
    // control an id ending in "-form-item". Focus also scrolls it into view.
    addCard.current?.querySelector<HTMLElement>('[id$="-form-item"]')?.focus();
  };

  // Focus moves to the next row (or the table) once this one is gone.
  const remove = async (row: (typeof income)[number], from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    await softDeleteWithUndo({
      repo: incomeRepo,
      row,
      message: "Income entry deleted.",
      undoneMessage: "Income entry restored.",
      onChange: () => router.invalidate(),
    });
    await router.invalidate();
    refocus();
  };

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
        <Card ref={addCard}>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Add entry</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1.2fr_1.2fr_1fr_1.8fr]">
            <TSFormField
              form={form}
              name="date"
              requirement="required"
              validators={{ onBlur: fieldSchemas.date }}
            >
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
            <TSFormField
              form={form}
              name="amount"
              requirement="required"
              validators={{ onBlur: fieldSchemas.amount }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      ref={amountInput}
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
            <TSFormField form={form} name="clientId" requirement="optional">
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
            <TSFormField form={form} name="kind" requirement="required">
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
            <TSFormField form={form} name="description" requirement="optional">
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
                <DataTable.Row
                  key={i.id}
                  id={rowAnchor(i.id)}
                  className={hash === rowAnchor(i.id) ? "bg-accent" : ""}
                >
                  <DataTable.Cell label="Date">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap">{formatDate(i.date)}</span>
                      <PreSeStartBadge rowDate={i.date} seStartDate={profile?.seStartDate} />
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell label="Client">
                    <ParentName parent={allClients.find((c) => c.id === i.clientId)} />
                  </DataTable.Cell>
                  <DataTable.Cell label="Kind">
                    {labelFor(INCOME_KIND_LABELS, i.kind)}
                  </DataTable.Cell>
                  <DataTable.Cell label="Description">{i.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell label="Amount" align="right">
                    {formatUSD(cents(i.amountCents))}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditIncomeDialog
                        income={i}
                        clients={allClients}
                        onSaved={() => router.invalidate()}
                      />
                      <AttachDialog
                        recordType="income"
                        recordId={i.id}
                        recordDate={i.date}
                        recordLabel={recordLabel.income(i)}
                        count={linkCounts[i.id] ?? 0}
                        onChanged={() => router.invalidate()}
                      />
                      <Button variant="ghost" size="sm" onClick={() => duplicate(i)}>
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => void remove(i, e.currentTarget)}
                      >
                        Delete <span className="sr-only">{recordLabel.income(i)}</span>
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
