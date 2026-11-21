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
import { homeOfficeRepo } from "@fiscode/db";
import type { HomeOfficeRow } from "@fiscode/csv";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  centsField,
  homeOfficeFieldSchemas,
  overlapsSimplified,
  SECOND_SIMPLIFIED_MESSAGE,
  withAreaCheck,
} from "../lib/home-office-form";
import { HomeOfficeFields } from "./home-office-fields";
import { dateToIso, isoToDate } from "./forms/date-picker";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { useToday } from "../lib/use-today";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { recordLabel } from "../lib/record-label";
import { submitForm } from "../lib/submit-form";

const editSchema = withAreaCheck(z.object(homeOfficeFieldSchemas));

export function EditHomeOfficeDialog({
  row,
  rows,
  onSaved,
}: {
  row: HomeOfficeRow;
  /** Every config, for the one-simplified-home-a-year check. */
  rows: readonly HomeOfficeRow[];
  onSaved: () => void;
}) {
  // Set when a save is refused for a second simplified home in a year.
  const [methodError, setMethodError] = useState<string | undefined>();
  const today = useToday();
  const form = useForm({
    defaultValues: {
      startDate: isoToDate(row.startDate) ?? today,
      endDate: row.endDate ? isoToDate(row.endDate) : (undefined as Date | undefined),
      method: (row.method as "simplified" | "actual") ?? "simplified",
      officeSqft: row.officeSqft === null ? "" : String(row.officeSqft),
      homeSqft: row.homeSqft === null ? "" : String(row.homeSqft),
      rentMortgage: centsField(row.monthlyRentMortgageCents),
      utilities: centsField(row.monthlyUtilitiesCents),
      insurance: centsField(row.monthlyInsuranceCents),
    },
    validators: { onSubmit: editSchema as never },
    onSubmit: async ({ value, formApi }) => {
      if (noChangesToSave(formApi)) return setOpen(false);
      const parsed = editSchema.parse(value);
      const startDate = dateToIso(value.startDate!);
      const endDate = value.endDate ? dateToIso(value.endDate) : null;
      setMethodError(undefined);
      if (overlapsSimplified(rows, { id: row.id, method: parsed.method, startDate, endDate })) {
        setMethodError(SECOND_SIMPLIFIED_MESSAGE);
        return;
      }
      // The engine reads the monthly costs for Actual only.
      const actual = parsed.method === "actual";
      await homeOfficeRepo.update(row.id, {
        startDate,
        endDate,
        method: parsed.method,
        officeSqft: parsed.officeSqft,
        homeSqft: parsed.homeSqft,
        monthlyRentMortgageCents: actual ? parsed.rentMortgage : null,
        monthlyUtilitiesCents: actual ? parsed.utilities : null,
        monthlyInsuranceCents: actual ? parsed.insurance : null,
      });
      toast.success("Home office config updated.");
      setOpen(false);
      onSaved();
    },
  });
  const { open, setOpen, onOpenChange } = useEditDialog(form, () => setMethodError(undefined));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit <span className="sr-only">{recordLabel.homeOffice(row)}</span>
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
            void submitForm(form);
          }}
        >
          <div className="@container grid gap-3">
            <HomeOfficeFields form={form} methodError={methodError} />
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
