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
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { incomeRepo } from "@fiscode/db";
import type { ClientRow, IncomeRow } from "@fiscode/csv";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";

const KIND_OPTIONS = [
  { value: "recurring", label: "Recurring" },
  { value: "bonus", label: "Bonus" },
  { value: "consulting", label: "Consulting" },
  { value: "other", label: "Other" },
];

const editSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: z.string().refine((v) => parseUSD(v) !== undefined, "Enter a valid amount"),
  clientId: z.string(),
  kind: z.enum(["recurring", "bonus", "consulting", "other"], { message: "Pick a kind" }),
  description: z.string(),
});

export function EditIncomeDialog({
  income,
  clients,
  onSaved,
}: {
  income: IncomeRow;
  clients: ClientRow[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      date: isoToDate(income.date) ?? new Date(),
      amount: formatUSD(cents(income.amountCents)).replace(/[$,]/g, ""),
      clientId: income.clientId ?? "",
      kind: (income.kind as "recurring" | "bonus" | "consulting" | "other") ?? "recurring",
      description: income.description ?? "",
    },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value }) => {
      await incomeRepo.update(income.id, {
        date: dateToIso(value.date!),
        amountCents: parseUSD(value.amount)!,
        clientId: value.clientId || null,
        kind: value.kind,
        description: value.description || null,
      });
      toast.success("Income updated.");
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
          <DialogTitle>Edit income</DialogTitle>
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
            <TSFormField form={form} name="clientId">
              {(field) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
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
                      onValueChange={(v) =>
                        field.handleChange(v as "recurring" | "bonus" | "consulting" | "other")
                      }
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
