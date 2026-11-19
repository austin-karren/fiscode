import { useRef } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Badge } from "@fiscode/ui/components/badge";
import { FieldCheckbox } from "../components/forms/field-checkbox";
import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@fiscode/ui/components/form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@fiscode/ui/components/field";
import { expenseRepo, profileRepo } from "@fiscode/db";
import { cents, EXPENSE_CATEGORY_LABELS, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { InfoTooltip } from "../components/info-tooltip";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditExpenseDialog } from "../components/edit-expense-dialog";
import { moneyAmount } from "../lib/field-schemas";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { Tooltip, TooltipContent, TooltipTrigger } from "@fiscode/ui/components/tooltip";
import { GLOSSARY } from "../lib/tax-glossary";
import { useToday } from "../lib/use-today";
import { formatDate } from "../lib/format-date";
import { SectionTitle } from "../components/section-title";

const CATEGORIES = Object.entries(EXPENSE_CATEGORY_LABELS);

const labelFor = (code: string) => CATEGORIES.find(([c]) => c === code)?.[1] ?? code;

const expenseFormSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: moneyAmount,
  category: z.string(),
  description: z.string(),
  flagForSection179: z.boolean(),
  startupExpense: z.boolean(),
});
// Per-field schemas (onBlur). Form-level schema (onSubmit) re-runs them all.
const fs = expenseFormSchema.shape;

export const Route = createFileRoute("/expenses")({
  loader: async () => ({
    expenses: await expenseRepo.list(),
    profile: await profileRepo.get(),
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { expenses, profile } = useLoaderData({ from: "/expenses" });
  const router = useRouter();

  const today = useToday();
  const empty = {
    date: today as Date | undefined,
    amount: "",
    category: "software_subs",
    description: "",
    flagForSection179: false,
    startupExpense: false,
  };
  // The add card, and its first value field: focus targets after Add and Duplicate.
  const addCard = useRef<HTMLDivElement>(null);
  const firstValue = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: empty,
    validators: { onSubmit: expenseFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const parsed = moneyAmount.parse(value.amount);
      await expenseRepo.create({
        date: dateToIso(value.date!),
        amountCents: parsed,
        category: value.category,
        clientId: null,
        description: value.description || null,
        reason: null,
        notes: null,
        flagForSection179: value.flagForSection179,
        startupExpense: value.startupExpense,
        deletedAt: null,
      });
      toast.success("Expense added.");
      // A run of entries shares the date and the category: keep those, clear the
      // rest, go on with the amount.
      formApi.reset(
        { ...empty, date: value.date, category: value.category },
        { keepDefaultValues: true },
      );
      router.invalidate();
      firstValue.current?.focus();
    },
  });

  // Fills the add form with a row's values, and puts focus on its date, the
  // value a copy most often changes.
  const duplicate = (row: (typeof expenses)[number]) => {
    form.reset(
      {
        date: isoToDate(row.date) ?? today,
        amount: formatUSD(cents(row.amountCents)).replace(/[$,]/g, ""),
        category: row.category,
        description: row.description ?? "",
        flagForSection179: row.flagForSection179,
        startupExpense: row.startupExpense,
      },
      { keepDefaultValues: true },
    );
    // The first form control is the date field's trigger; FormControl gives each
    // control an id ending in "-form-item". Focus also scrolls it into view.
    addCard.current?.querySelector<HTMLElement>('[id$="-form-item"]')?.focus();
  };

  const remove = (row: (typeof expenses)[number]) =>
    softDeleteWithUndo({
      repo: expenseRepo,
      row,
      message: "Expense deleted.",
      undoneMessage: "Expense restored.",
      onChange: () => router.invalidate(),
    });

  return (
    <Page
      title="Expenses"
      description="Business expenses. Categorize so the year-end packet groups cleanly."
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
              <SectionTitle>Add expense</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.5fr_2fr_auto]">
            <TSFormField
              form={form}
              name="date"
              requirement="required"
              validators={{ onBlur: fs.date }}
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
              validators={{ onBlur: fs.amount }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      ref={firstValue}
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
            <TSFormField form={form} name="category" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.expenseCategory}>Category</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={CATEGORIES.map(([c, l]) => ({
                        value: c,
                        label: l,
                      }))}
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
            <TSFormField form={form} name="flagForSection179">
              {(field) => (
                <FormItem className="relative @sm:col-span-2 @4xl:col-span-5">
                  {/* The card is one <label>, so its text names the checkbox.
                      The info button stays outside it to keep that name clean. */}
                  <InfoTooltip
                    text={GLOSSARY.section179}
                    ariaLabel="More info about §179 candidate"
                    className="absolute top-3 right-3 z-10"
                  />
                  {/* The hint as the checkbox's description (see LabelWithTooltip). */}
                  <FormDescription className="sr-only">{GLOSSARY.section179}</FormDescription>
                  <FieldLabel>
                    <Field orientation="horizontal">
                      <FormControl>
                        <FieldCheckbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                          onBlur={field.handleBlur}
                        />
                      </FormControl>
                      <FieldContent>
                        <FieldTitle>§179 candidate</FieldTitle>
                        <FieldDescription>
                          Equipment you'd like to fully expense this year rather than depreciate.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="startupExpense">
              {(field) => (
                <FormItem className="@sm:col-span-2 @4xl:col-span-5">
                  <FieldLabel>
                    <Field orientation="horizontal">
                      <FormControl>
                        <FieldCheckbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                          onBlur={field.handleBlur}
                        />
                      </FormControl>
                      <FieldContent>
                        <FieldTitle>Startup expense (Section 195)</FieldTitle>
                        <FieldDescription>
                          Bought in anticipation of 1099 work — count it in the year even if dated
                          before your SE start date.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
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

      {expenses.length === 0 ? (
        <NoDataEmpty
          icon={Receipt}
          title="No expenses yet"
          description="Add a business expense above. Categories drive how it lands in the year-end packet."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Date</DataTable.HeaderCell>
              <DataTable.HeaderCell>Category</DataTable.HeaderCell>
              <DataTable.HeaderCell>Description</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {expenses
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((x) => (
                <DataTable.Row key={x.id}>
                  <DataTable.Cell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap">{formatDate(x.date)}</span>
                      {x.startupExpense ? (
                        <Badge variant="secondary">Startup §195</Badge>
                      ) : (
                        <PreSeStartBadge
                          rowDate={x.date}
                          seStartDate={profile?.seStartDate}
                          startupHint
                        />
                      )}
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {labelFor(x.category)}
                    {x.flagForSection179 ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="ml-2 inline-flex cursor-help">
                              <Badge variant="secondary">§179</Badge>
                            </span>
                          }
                        />
                        <TooltipContent className="max-w-xs text-xs">
                          {GLOSSARY.section179}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </DataTable.Cell>
                  <DataTable.Cell>{x.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatUSD(cents(x.amountCents))}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditExpenseDialog
                        expense={x}
                        categories={CATEGORIES}
                        onSaved={() => router.invalidate()}
                      />
                      <Button variant="ghost" size="sm" onClick={() => duplicate(x)}>
                        Duplicate
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(x)}>
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
