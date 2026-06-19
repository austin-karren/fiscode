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
import { mileageRepo } from "@fiscode/db";
import type { MileageRow, VehicleRow } from "@fiscode/csv";
import { positiveIntegerString } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";

const editSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  miles: positiveIntegerString,
  vehicleId: z.string(),
  purpose: z.string(),
});

export function EditMileageDialog({
  mileage,
  vehicles,
  onSaved,
}: {
  mileage: MileageRow;
  vehicles: VehicleRow[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: {
      date: isoToDate(mileage.date) ?? new Date(),
      miles: String(mileage.businessMiles),
      vehicleId: mileage.vehicleId ?? "",
      purpose: mileage.purpose ?? "",
    },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value }) => {
      const parsed = editSchema.parse(value);
      await mileageRepo.update(mileage.id, {
        date: dateToIso(value.date!),
        vehicleId: value.vehicleId || null,
        businessMiles: parsed.miles,
        purpose: value.purpose || null,
      });
      toast.success("Mileage updated.");
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
          <DialogTitle>Edit mileage</DialogTitle>
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
            <TSFormField form={form} name="miles">
              {(field) => (
                <FormItem>
                  <FormLabel>Business miles</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="vehicleId">
              {(field) => (
                <FormItem>
                  <FormLabel>Vehicle</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
                      items={[
                        { value: "__none__", label: "—" },
                        ...vehicles.map((v) => ({
                          value: v.id,
                          label: `${v.make} ${v.model}`,
                        })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="purpose">
              {(field) => (
                <FormItem>
                  <FormLabel>Purpose</FormLabel>
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
