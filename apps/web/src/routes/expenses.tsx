import { useRef } from "react";
import { createFileRoute, useLoaderData, useLocation, useRouter } from "@tanstack/react-router";
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
import { expenseRepo, profileRepo, documentLinkRepo } from "@fiscode/db";
import { cents, EXPENSE_CATEGORY_LABELS, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { AttachDialog } from "../components/documents/attach-dialog";
import { rowAnchor } from "../lib/documents-links";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { InfoTooltip } from "../components/info-tooltip";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { expenseYearDate, startupTickIgnoredForEquipment } from "@fiscode/core";
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
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { recordLabel } from "../lib/record-label";
import { placedInServiceFor } from "../lib/equipment";

const CATEGORIES = Object.entries(EXPENSE_CATEGORY_LABELS);

const labelFor = (code: string) => CATEGORIES.find(([c]) => c === code)?.[1] ?? code;

const expenseFormSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: moneyAmount,
  category: z.string(),
  description: z.string(),
  flagForSection179: z.boolean(),
  startupExpense: z.boolean(),
  placedInService: z.date().optional(),
});
// Per-field schemas (onBlur). Form-level schema (onSubmit) re-runs them all.
const fs = expenseFormSchema.shape;

export const Route = createFileRoute("/expenses")({
  loader: async () => {
    const expensesRows = await expenseRepo.list();
    return {
      expenses: expensesRows,
      // Documents per row, in one query for the screen.
      linkCounts: await documentLinkRepo.countsFor(
        "expense",
        expensesRows.map((r) => r.id),
      ),
      profile: await profileRepo.get(),
    };
  },
  component: ExpensesPage,
});

function ExpensesPage() {
  const { expenses, profile, linkCounts } = useLoaderData({ from: "/expenses" });
  const hash = useLocation({ select: (l) => l.hash });
  const router = useRouter();

  const today = useToday();
  const empty = {
    date: today as Date | undefined,
    amount: "",
    category: "software_subs",
    description: "",
    flagForSection179: false,
    startupExpense: false,
    placedInService: undefined as Date | undefined,
  };
  // The add card, and its first value field: focus targets after Add and Duplicate.
  const addCard = useRef<HTMLDivElement>(null);
  const firstValue = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: empty,
    // Cast: zod's optional Date and TanStack Form's exactOptional differ (as in profile.tsx).
    validators: { onSubmit: expenseFormSchema as never },
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
        startupExpense: value.category === "equipment" ? false : value.startupExpense,
        placedInServiceDate: placedInServiceFor(
          value.category,
          value.date ? dateToIso(value.date) : undefined,
          value.placedInService ? dateToIso(value.placedInService) : undefined,
          profile?.seStartDate,
        ),
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
        placedInService: row.placedInServiceDate ? isoToDate(row.placedInServiceDate) : undefined,
      },
      { keepDefaultValues: true },
    );
    // The first form control is the date field's trigger; FormControl gives each
    // control an id ending in "-form-item". Focus also scrolls it into view.
    addCard.current?.querySelector<HTMLElement>('[id$="-form-item"]')?.focus();
  };

  // Focus moves to the next row (or the table) once this one is gone.
  const remove = async (row: (typeof expenses)[number], from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    await softDeleteWithUndo({
      repo: expenseRepo,
      row,
      message: "Expense deleted.",
      undoneMessage: "Expense restored.",
      onChange: () => router.invalidate(),
    });
    await router.invalidate();
    refocus();
  };

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
                      onValueChange={(v) => {
                        field.handleChange(v);
                        // §195 excludes equipment: a box ticked under another
                        // category must not ride along, disabled and unclearable.
                        if (v === "equipment") form.setFieldValue("startupExpense", false);
                      }}
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
            {/* §195 excludes depreciable property: equipment goes by its
                placed-in-service date, so the box is off for Equipment. */}
            <form.Subscribe selector={(st) => st.values.category === "equipment"}>
              {(isEquipment) => (
                <TSFormField form={form} name="startupExpense">
                  {(field) => (
                    <FormItem className="@sm:col-span-2 @4xl:col-span-5">
                      <FieldLabel>
                        <Field orientation="horizontal" data-disabled={isEquipment || undefined}>
                          <FormControl>
                            <FieldCheckbox
                              checked={field.state.value}
                              onCheckedChange={(v) => field.handleChange(v)}
                              onBlur={field.handleBlur}
                              disabled={isEquipment}
                            />
                          </FormControl>
                          <FieldContent>
                            <FieldTitle>Startup expense (Section 195)</FieldTitle>
                            <FieldDescription>
                              Bought in anticipation of 1099 work — count it in the year even if
                              dated before your SE start date.
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                      {/* Outside the label: inside it, it would be read as
                          part of the box's name as well as its description. */}
                      {isEquipment ? (
                        <FormDescription className="text-xs">
                          Equipment uses its placed-in-service date instead.
                        </FormDescription>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                </TSFormField>
              )}
            </form.Subscribe>
            <form.Subscribe
              selector={(s) => ({ category: s.values.category, date: s.values.date })}
            >
              {({ category, date }) =>
                category === "equipment" ? (
                  <TSFormField form={form} name="placedInService" requirement="optional">
                    {(field) => (
                      <FormItem>
                        <LabelWithTooltip tooltip={GLOSSARY.placedInService}>
                          Placed in service
                        </LabelWithTooltip>
                        <FormControl>
                          <DatePicker
                            value={
                              (field.state.value as Date | undefined) ??
                              isoToDate(
                                placedInServiceFor(
                                  category,
                                  date ? dateToIso(date) : undefined,
                                  undefined,
                                  profile?.seStartDate,
                                ) ?? "",
                              )
                            }
                            onBlur={field.handleBlur}
                            onValueChange={(d) => field.handleChange(d)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  </TSFormField>
                ) : null
              }
            </form.Subscribe>
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
                <DataTable.Row
                  key={x.id}
                  id={rowAnchor(x.id)}
                  highlighted={hash === rowAnchor(x.id)}
                >
                  <DataTable.Cell label="Date">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap">{formatDate(x.date)}</span>
                      {startupTickIgnoredForEquipment(
                        x,
                        profile?.seStartDate,
                      ) ? null : x.startupExpense ? (
                        <Badge variant="secondary">Startup §195</Badge>
                      ) : (
                        <PreSeStartBadge
                          rowDate={expenseYearDate(x, profile?.seStartDate)}
                          seStartDate={profile?.seStartDate}
                          startupHint
                        />
                      )}
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell label="Category">
                    {labelFor(x.category)}
                    {/* Ticked Startup before the ruling: §195 excludes equipment
                        (d-data #75), so the tick is ignored; say why on the row. */}
                    {startupTickIgnoredForEquipment(x, profile?.seStartDate) ? (
                      <span className="block text-xs text-muted-foreground">
                        Equipment uses its placed-in-service date instead.
                      </span>
                    ) : null}
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
                  <DataTable.Cell label="Description">{x.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell label="Amount" align="right">
                    {formatUSD(cents(x.amountCents))}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditExpenseDialog
                        expense={x}
                        categories={CATEGORIES}
                        onSaved={() => router.invalidate()}
                        seStartDate={profile?.seStartDate}
                      />
                      <AttachDialog
                        recordType="expense"
                        recordId={x.id}
                        recordDate={x.date}
                        recordLabel={recordLabel.expense(x)}
                        count={linkCounts[x.id] ?? 0}
                        onChanged={() => router.invalidate()}
                      />
                      <Button variant="ghost" size="sm" onClick={() => duplicate(x)}>
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => void remove(x, e.currentTarget)}
                      >
                        Delete <span className="sr-only">{recordLabel.expense(x)}</span>
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
