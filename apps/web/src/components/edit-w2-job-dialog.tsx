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

import { w2JobRepo, type W2JobRow } from "../lib/w2-payments-stub";
import { noChangesToSave, useEditDialog } from "../hooks/use-edit-dialog";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { W2Fields, w2InsertFrom, w2Label, w2ValuesFrom, useW2Form } from "./w2-job-form";

export function EditW2JobDialog({
  job,
  year,
  onSaved,
}: {
  job: W2JobRow;
  year: number;
  onSaved: () => void;
}) {
  const form = useW2Form(w2ValuesFrom(job), (value) => save(value));
  const { open, setOpen, onOpenChange } = useEditDialog(form);
  async function save(value: Parameters<typeof w2InsertFrom>[0]) {
    if (noChangesToSave(form)) return setOpen(false);
    await w2JobRepo.update(job.id, w2InsertFrom(value));
    toast.success("W-2 updated.");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            Edit <span className="sr-only">{w2Label(job)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit W-2</DialogTitle>
          <DialogDescription>Update fields and save.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <W2Fields form={form} year={year} />
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
