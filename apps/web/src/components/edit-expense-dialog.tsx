import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fiscode/ui/components/dialog";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Checkbox } from "@fiscode/ui/components/checkbox";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { expenseRepo } from "@fiscode/db";
import type { ExpenseRow } from "@fiscode/csv";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { LabelWithTooltip } from "./forms/labeled";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { GLOSSARY } from "../lib/tax-glossary";

const editSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: z.string().refine((v) => parseUSD(v) !== undefined, "Enter a valid amount"),
  category: z.string(),
  description: z.string(),
  flagForSection179: z.boolean(),
  startupExpense: z.boolean(),
});

export function EditExpenseDialog({
  expense,
  categories,
  onSaved,
}: {
  expense: ExpenseRow;
  categories: ReadonlyArray<readonly [string, string]>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      date: isoToDate(expense.date) ?? new Date(),
      amount: formatUSD(cents(expense.amountCents)).replace(/[$,]/g, ""),
      category: expense.category,
      description: expense.description ?? "",
      flagForSection179: expense.flagForSection179,
      startupExpense: expense.startupExpense ?? false,
    },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value }) => {
      const parsed = parseUSD(value.amount)!;
      await expenseRepo.update(expense.id, {
        date: dateToIso(value.date!),
        amountCents: parsed,
        category: value.category,
        description: value.description || null,
        flagForSection179: value.flagForSection179,
        startupExpense: value.startupExpense,
      });
      toast.success("Expense updated.");
      setOpen(false);
      onSaved();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit
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
            <TSFormField form={form} name="date">
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d ?? new Date())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="amount">
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
                      items={categories.map(([c, l]) => ({ value: c, label: l }))}
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
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.state.value}
                      onCheckedChange={(v) => field.handleChange(v === true)}
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
                    <Checkbox
                      checked={field.state.value}
                      onCheckedChange={(v) => field.handleChange(v === true)}
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
          </div>
          <DialogFooter className="mt-4" showCloseButton>
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
