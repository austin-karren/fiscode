import { useState } from "react";
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
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo } from "@fiscode/db";
import type { EntityRow } from "@fiscode/csv";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { CONFIG_YEARS_BACK, DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { ENTITY_TYPE_LABELS, EntityPeriodError, labelOptions } from "@fiscode/core";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import {
  entityPeriodFieldError,
  periodErrorFor,
  type EntityPeriodFieldError,
} from "../lib/entity-period-error";
import { useToday } from "../lib/use-today";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { recordLabel } from "../lib/record-label";
import { submitForm } from "../lib/submit-form";

const ENTITY_OPTIONS = labelOptions(ENTITY_TYPE_LABELS).filter((o) => o.value !== "s_corp");

const editSchema = z.object({
  type: z.enum(["sole_prop", "single_member_llc"], { message: "Pick a type" }),
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
});

export function EditEntityDialog({ entity, onSaved }: { entity: EntityRow; onSaved: () => void }) {
  // Set when the repo blocks the dates; shown on the field it is about.
  const [periodError, setPeriodError] = useState<EntityPeriodFieldError | null>(null);

  const today = useToday();
  const form = useForm({
    defaultValues: {
      type: entity.type as "sole_prop" | "single_member_llc",
      startDate: isoToDate(entity.startDate) ?? today,
      endDate: entity.endDate ? isoToDate(entity.endDate) : (undefined as Date | undefined),
    },
    validators: { onSubmit: editSchema as never },
    onSubmit: async ({ value, formApi }) => {
      if (noChangesToSave(formApi)) return setOpen(false);
      setPeriodError(null);
      try {
        await entityRepo.update(entity.id, {
          type: value.type,
          startDate: dateToIso(value.startDate!),
          endDate: value.endDate ? dateToIso(value.endDate) : null,
        });
      } catch (err) {
        if (!(err instanceof EntityPeriodError)) throw err;
        setPeriodError(entityPeriodFieldError(err));
        return;
      }
      toast.success("Entity period updated.");
      setOpen(false);
      onSaved();
    },
  });
  const { open, setOpen, onOpenChange } = useEditDialog(form, () => setPeriodError(null));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit <span className="sr-only">{recordLabel.entity(entity)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit entity period</DialogTitle>
          <DialogDescription>Update the entity type or date range.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void submitForm(form);
          }}
        >
          <div className="grid gap-3">
            <TSFormField form={form} name="type" requirement="required">
              {(field) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) =>
                        field.handleChange(v as "sole_prop" | "single_member_llc")
                      }
                      items={ENTITY_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="startDate"
              requirement="required"
              error={periodErrorFor(periodError, "startDate")}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Start</FormLabel>
                  <FormControl>
                    <DatePicker
                      yearsBack={CONFIG_YEARS_BACK}
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d ?? new Date())}
                    />
                  </FormControl>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="endDate"
              requirement="optional"
              error={periodErrorFor(periodError, "endDate")}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>End</FormLabel>
                  <FormControl>
                    <DatePicker
                      yearsBack={CONFIG_YEARS_BACK}
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d)}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            </TSFormField>
          </div>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting })}>
              {({ isSubmitting }) => (
                <Button type="submit" disabled={isSubmitting}>
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
