import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Badge } from "@fiscode/ui/components/badge";
import { Checkbox } from "@fiscode/ui/components/checkbox";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@fiscode/ui/components/field";
import { expenseRepo, profileRepo } from "@fiscode/db";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditExpenseDialog } from "../components/edit-expense-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@fiscode/ui/components/tooltip";
import { GLOSSARY } from "../lib/tax-glossary";

const CATEGORIES = [
  ["health_insurance", "Self-employed health insurance"],
  ["phone_internet", "Phone / internet"],
  ["software_subs", "Software & subscriptions"],
  ["professional_services", "Professional services"],
  ["meals", "Business meals (50%)"],
  ["equipment", "Equipment (§179 / bonus)"],
  ["home_office", "Home office"],
  ["vehicle", "Vehicle"],
  ["supplies", "Supplies"],
  ["travel", "Travel"],
  ["advertising", "Advertising"],
  ["other", "Other"],
] as const;

const labelFor = (code: string) => CATEGORIES.find(([c]) => c === code)?.[1] ?? code;

const expenseFormSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: z.string().refine((v) => parseUSD(v) !== undefined, "Enter a valid amount"),
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

  const form = useForm({
    defaultValues: {
      date: new Date() as Date | undefined,
      amount: "",
      category: "software_subs",
      description: "",
      flagForSection179: false,
      startupExpense: false,
    },
    validators: { onSubmit: expenseFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const parsed = parseUSD(value.amount)!;
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
      formApi.reset();
      router.invalidate();
    },
  });

  const remove = async (id: string) => {
    await expenseRepo.softDelete(id);
    router.invalidate();
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Add expense
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.5fr_2fr_auto]">
            <TSFormField form={form} name="date" validators={{ onBlur: fs.date }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="amount" validators={{ onBlur: fs.amount }}>
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
            <TSFormField form={form} name="category">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.expenseCategory}>Category</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
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
            <TSFormField form={form} name="flagForSection179">
              {(field) => (
                <FormItem className="@sm:col-span-2 @4xl:col-span-5">
                  <FieldLabel htmlFor="flag-section-179">
                    <Field orientation="horizontal">
                      <FormControl>
                        <Checkbox
                          id="flag-section-179"
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v === true)}
                        />
                      </FormControl>
                      <FieldContent>
                        <FieldTitle>
                          <LabelWithTooltip tooltip={GLOSSARY.section179}>
                            §179 candidate
                          </LabelWithTooltip>
                        </FieldTitle>
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
                  <FieldLabel htmlFor="flag-startup-expense">
                    <Field orientation="horizontal">
                      <FormControl>
                        <Checkbox
                          id="flag-startup-expense"
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v === true)}
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
                      <span className="font-mono">{x.date}</span>
                      {x.startupExpense ? (
                        <Badge variant="secondary">Startup §195</Badge>
                      ) : (
                        <PreSeStartBadge rowDate={x.date} seStartDate={profile?.seStartDate} />
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
                      <Button variant="ghost" size="sm" onClick={() => remove(x.id)}>
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
