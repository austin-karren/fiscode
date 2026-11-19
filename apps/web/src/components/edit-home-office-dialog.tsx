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
import { homeOfficeRepo } from "@fiscode/db";
import type { HomeOfficeRow } from "@fiscode/csv";
import { HOME_OFFICE_METHOD_LABELS, labelOptions } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { optionalSqft } from "../lib/field-schemas";
import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";

const METHOD_OPTIONS = labelOptions(HOME_OFFICE_METHOD_LABELS);

const editSchema = z.object({
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
  method: z.enum(["simplified", "actual"], { message: "Pick a method" }),
  officeSqft: optionalSqft,
  homeSqft: optionalSqft,
});

export function EditHomeOfficeDialog({
  row,
  onSaved,
}: {
  row: HomeOfficeRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      startDate: isoToDate(row.startDate) ?? new Date(),
      endDate: row.endDate ? isoToDate(row.endDate) : (undefined as Date | undefined),
      method: (row.method as "simplified" | "actual") ?? "simplified",
      officeSqft: row.officeSqft === null ? "" : String(row.officeSqft),
      homeSqft: row.homeSqft === null ? "" : String(row.homeSqft),
    },
    validators: { onSubmit: editSchema as never },
    onSubmit: async ({ value }) => {
      const parsed = editSchema.parse(value);
      await homeOfficeRepo.update(row.id, {
        startDate: dateToIso(value.startDate!),
        endDate: value.endDate ? dateToIso(value.endDate) : null,
        method: parsed.method,
        officeSqft: parsed.officeSqft,
        homeSqft: parsed.homeSqft,
      });
      toast.success("Home office config updated.");
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
          <DialogTitle>Edit home office config</DialogTitle>
          <DialogDescription>Update fields and save.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <TSFormField form={form} name="startDate">
              {(field) => (
                <FormItem>
                  <FormLabel>Start date</FormLabel>
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
            <TSFormField form={form} name="endDate">
              {(field) => (
                <FormItem>
                  <FormLabel>End date (optional)</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d)}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="method">
              {(field) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v as "simplified" | "actual")}
                      items={METHOD_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="officeSqft"
              validators={{ onBlur: editSchema.shape.officeSqft }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Office sqft</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="homeSqft"
              validators={{ onBlur: editSchema.shape.homeSqft }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Home sqft</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
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
