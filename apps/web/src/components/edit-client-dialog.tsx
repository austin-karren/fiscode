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
import { clientRepo } from "@fiscode/db";
import type { ClientRow } from "@fiscode/csv";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { TSFormField } from "./forms/ts-form-field";
import { EnterToSubmitForm } from "./forms/enter-to-submit-form";

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string(),
  defaultRate: z.string(),
});

export function EditClientDialog({ client, onSaved }: { client: ClientRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);

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
        defaultRateCents: value.defaultRate ? (parseUSD(value.defaultRate) ?? null) : null,
      });
      toast.success("Client updated.");
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
            <TSFormField form={form} name="name">
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
            <TSFormField form={form} name="type">
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
            <TSFormField form={form} name="defaultRate">
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
