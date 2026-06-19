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
import { spouseRepo } from "@fiscode/db";
import type { SpouseRow } from "@fiscode/csv";
import { cents, optionalUsdString } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";

const editSchema = z.object({
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
  wages: optionalUsdString,
  fedWH: optionalUsdString,
  stateWH: optionalUsdString,
});

const centsToDollarsStr = (c: number) => (c / 100).toFixed(2);

export function EditSpouseDialog({ spouse, onSaved }: { spouse: SpouseRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      startDate: isoToDate(spouse.startDate) ?? new Date(),
      endDate: spouse.endDate ? isoToDate(spouse.endDate) : (undefined as Date | undefined),
      wages: centsToDollarsStr(spouse.annualW2WagesCents),
      fedWH: centsToDollarsStr(spouse.annualFederalWithholdingCents),
      stateWH: centsToDollarsStr(spouse.annualStateWithholdingCents),
    },
    validators: { onSubmit: editSchema as never },
    onSubmit: async ({ value }) => {
      const parsed = editSchema.parse(value);
      await spouseRepo.update(spouse.id, {
        startDate: dateToIso(value.startDate!),
        endDate: value.endDate ? dateToIso(value.endDate) : null,
        annualW2WagesCents: parsed.wages ?? cents(0),
        annualFederalWithholdingCents: parsed.fedWH ?? cents(0),
        annualStateWithholdingCents: parsed.stateWH ?? cents(0),
      });
      toast.success("Spouse block updated.");
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
          <DialogTitle>Edit spouse block</DialogTitle>
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
                  <FormLabel>Start</FormLabel>
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
            <TSFormField form={form} name="endDate">
              {(field) => (
                <FormItem>
                  <FormLabel>End (optional)</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="wages">
              {(field) => (
                <FormItem>
                  <FormLabel>Annual W-2 wages</FormLabel>
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
            <TSFormField form={form} name="fedWH">
              {(field) => (
                <FormItem>
                  <FormLabel>Fed withholding</FormLabel>
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
            <TSFormField form={form} name="stateWH">
              {(field) => (
                <FormItem>
                  <FormLabel>State withholding</FormLabel>
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
