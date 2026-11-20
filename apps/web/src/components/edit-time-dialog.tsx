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
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { timeRepo } from "@fiscode/db";
import type { ClientRow, TimeEntryRow } from "@fiscode/csv";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { hoursField, hoursWorked } from "../lib/field-schemas";
import { TSFormField } from "./forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { SelectWithLabels } from "./forms/select-with-labels";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { archivedSuffix, pickableParents } from "./parent-name";
import { useToday } from "../lib/use-today";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { recordLabel } from "../lib/record-label";

const editSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  hours: hoursWorked,
  clientId: z.string(),
  description: z.string(),
});

export function EditTimeDialog({
  entry,
  clients,
  onSaved,
}: {
  entry: TimeEntryRow;
  clients: ClientRow[];
  onSaved: () => void;
}) {
  const today = useToday();
  const form = useForm({
    defaultValues: {
      date: isoToDate(entry.date) ?? today,
      hours: hoursField(entry.minutes),
      clientId: entry.clientId ?? "",
      description: entry.description ?? "",
    },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value, formApi }) => {
      if (noChangesToSave(formApi)) return setOpen(false);
      const parsed = editSchema.parse(value);
      await timeRepo.update(entry.id, {
        date: dateToIso(value.date!),
        clientId: value.clientId || null,
        minutes: Math.round(parsed.hours * 60),
        description: value.description || null,
      });
      toast.success("Time entry updated.");
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
            Edit <span className="sr-only">{recordLabel.time(entry)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit time entry</DialogTitle>
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
              name="hours"
              requirement="required"
              validators={{ onBlur: editSchema.shape.hours }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Hours</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="clientId" requirement="optional">
              {(field) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
                      items={[
                        { value: "__none__", label: "—" },
                        ...pickableParents(clients, entry.clientId).map((c) => ({
                          value: c.id,
                          label: `${c.name}${archivedSuffix(c)}`,
                        })),
                      ]}
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
