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
import { clientRepo } from "@fiscode/db";
import type { ClientRow } from "@fiscode/csv";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { optionalMoneyAmount } from "../lib/field-schemas";
import { TSFormField } from "./forms/ts-form-field";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";
import { useEditDialog } from "../hooks/use-edit-dialog";
import { recordLabel } from "../lib/record-label";

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string(),
  defaultRate: optionalMoneyAmount,
});

export function EditClientDialog({ client, onSaved }: { client: ClientRow; onSaved: () => void }) {
  const form = useForm({
    defaultValues: {
      name: client.name,
      type: client.type ?? "",
      defaultRate:
        client.defaultRateCents !== null
          ? formatUSD(cents(client.defaultRateCents)).replace(/[$,]/g, "")
          : "",
    },
    validators: { onSubmit: editSchema },
    onSubmit: async ({ value }) => {
      await clientRepo.update(client.id, {
        name: value.name.trim(),
        type: value.type.trim() || null,
        defaultRateCents: optionalMoneyAmount.parse(value.defaultRate),
      });
      toast.success("Client updated.");
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
            Edit <span className="sr-only">{recordLabel.client(client)}</span>
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit client</DialogTitle>
          <DialogDescription>Update fields and save.</DialogDescription>
        </DialogHeader>
        <EnterToSubmitForm
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <TSFormField form={form} name="name" requirement="required">
              {(field) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
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
            <TSFormField form={form} name="type" requirement="optional">
              {(field) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="recurring, consulting"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="defaultRate"
              requirement="optional"
              validators={{ onBlur: editSchema.shape.defaultRate }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Default rate</FormLabel>
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
