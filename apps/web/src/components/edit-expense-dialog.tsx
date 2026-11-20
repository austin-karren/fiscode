import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fiscode/ui/components/dialog";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { FieldCheckbox } from "./forms/field-checkbox";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { expenseRepo } from "@fiscode/db";
import type { ExpenseRow } from "@fiscode/csv";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { moneyAmount } from "../lib/field-schemas";
import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { LabelWithTooltip } from "./forms/labeled";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { GLOSSARY } from "../lib/tax-glossary";
import { useToday } from "../lib/use-today";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { recordLabel } from "../lib/record-label";
import { placedInServiceFor } from "../lib/equipment";

const editSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: moneyAmount,
  category: z.string(),
  description: z.string(),
  flagForSection179: z.boolean(),
  startupExpense: z.boolean(),
  placedInService: z.date().optional(),
});

export function EditExpenseDialog({
  expense,
  categories,
  onSaved,
  seStartDate,
}: {
  expense: ExpenseRow;
  categories: ReadonlyArray<readonly [string, string]>;
  onSaved: () => void;
  /** For the equipment placed-in-service prefill. */
  seStartDate?: string | null;
}) {
  const today = useToday();
  const form = useForm({
    defaultValues: {
      date: isoToDate(expense.date) ?? today,
      amount: formatUSD(cents(expense.amountCents)).replace(/[$,]/g, ""),
      category: expense.category,
      description: expense.description ?? "",
      flagForSection179: expense.flagForSection179,
      startupExpense: expense.startupExpense ?? false,
      placedInService: expense.placedInServiceDate
        ? isoToDate(expense.placedInServiceDate)
        : (undefined as Date | undefined),
    },
    // Cast: zod's optional Date and TanStack Form's exactOptional differ (as in profile.tsx).
    validators: { onSubmit: editSchema as never },
    onSubmit: async ({ value, formApi }) => {
      // The prefilled placed-in-service date is shown, not typed, so the form can look
      // untouched while the row would still change: only skip when it wouldn't.
      const placedInServiceDate = placedInServiceFor(
        value.category,
        value.date ? dateToIso(value.date) : undefined,
        value.placedInService ? dateToIso(value.placedInService) : undefined,
        seStartDate,
      );
      if (
        noChangesToSave(formApi) &&
        placedInServiceDate === (expense.placedInServiceDate ?? null)
      ) {
        return setOpen(false);
      }
      const parsed = moneyAmount.parse(value.amount);
      await expenseRepo.update(expense.id, {
        date: dateToIso(value.date!),
        amountCents: parsed,
        category: value.category,
        description: value.description || null,
        flagForSection179: value.flagForSection179,
        startupExpense: value.startupExpense,
        placedInServiceDate,
      });
      toast.success("Expense updated.");
      setOpen(false);
      onSaved();
    },
  });
  const { open, setOpen, onOpenChange } = useEditDialog(form);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit <span className="sr-only">{recordLabel.expense(expense)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
          <DialogDescription>Update fields and save.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <TSFormField form={form} name="date" requirement="required">
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d ?? new Date())}
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
              validators={{ onBlur: editSchema.shape.amount }}
            >
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
            <TSFormField form={form} name="category" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.expenseCategory}>Category</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={categories.map(([c, l]) => ({ value: c, label: l }))}
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
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <FieldCheckbox
                      checked={field.state.value}
                      onCheckedChange={(v) => field.handleChange(v)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <LabelWithTooltip tooltip={GLOSSARY.section179} className="text-sm font-normal">
                    §179 candidate
                  </LabelWithTooltip>
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="startupExpense">
              {(field) => (
                <FormItem className="flex flex-row items-start gap-2">
                  <FormControl>
                    <FieldCheckbox
                      checked={field.state.value}
                      onCheckedChange={(v) => field.handleChange(v)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <div className="grid gap-0.5">
                    <FormLabel className="text-sm font-normal">
                      Startup expense (Section 195)
                    </FormLabel>
                    <span className="text-xs text-muted-foreground">
                      Bought in anticipation of 1099 work — count it in the year even if dated
                      before your SE start.
                    </span>
                  </div>
                </FormItem>
              )}
            </TSFormField>
            <form.Subscribe
              selector={(st) => ({ category: st.values.category, date: st.values.date })}
            >
              {({ category, date }) =>
                category === "equipment" ? (
                  <TSFormField form={form} name="placedInService">
                    {(field) => (
                      <FormItem>
                        <FormLabel>Placed in service</FormLabel>
                        <FormControl>
                          <DatePicker
                            value={
                              (field.state.value as Date | undefined) ??
                              isoToDate(
                                placedInServiceFor(
                                  category,
                                  date ? dateToIso(date) : undefined,
                                  undefined,
                                  seStartDate,
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
          </div>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </EnterToSubmitForm>
      </DialogContent>
    </Dialog>
  );
}
