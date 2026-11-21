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
import { toast } from "sonner";

import { estimatedPaymentRepo } from "@fiscode/db";
import type { EstimatedPaymentRow } from "@fiscode/csv";
import { formatDate } from "../lib/format-date";
import { useToday } from "../lib/use-today";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import {
  PaymentFields,
  paymentInsertFrom,
  paymentLabel,
  paymentValuesFrom,
  usePaymentForm,
} from "./payment-form";

export function EditPaymentDialog({
  payment,
  onSaved,
}: {
  payment: EstimatedPaymentRow;
  onSaved: () => void;
}) {
  const today = useToday();
  const form = usePaymentForm(paymentValuesFrom(payment, today), (value) => save(value));
  const { open, setOpen, onOpenChange } = useEditDialog(form);
  async function save(value: Parameters<typeof paymentInsertFrom>[0]) {
    if (noChangesToSave(form)) return setOpen(false);
    await estimatedPaymentRepo.update(payment.id, paymentInsertFrom(value));
    toast.success("Payment updated.");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit <span className="sr-only">{paymentLabel(payment, formatDate)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit payment</DialogTitle>
          <DialogDescription>Update fields and save.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <PaymentFields form={form} />
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
