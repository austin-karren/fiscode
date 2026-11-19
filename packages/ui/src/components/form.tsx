"use client";

import { Slot } from "radix-ui";
import * as React from "react";

import { Label } from "@fiscode/ui/components/label";
import { cn } from "@fiscode/ui/lib/utils";

// TanStack-Form-backed equivalent of shadcn's react-hook-form `Form` primitive.
// Same visual + a11y surface (FormItem/FormLabel/FormControl/FormDescription/FormMessage)
// but wired to TanStack Form's field state via a small context bridge.
//
// Usage:
//   <form onSubmit={(e) => { e.preventDefault(); void form.handleSubmit(); }}>
//     <FormField name="amount" errors={field.state.meta.errors}>
//       <FormItem>
//         <FormLabel>Amount</FormLabel>
//         <FormControl>
//           <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
//         </FormControl>
//         <FormMessage />
//       </FormItem>
//     </FormField>
//   </form>

type FormFieldError = { message?: string } | string | undefined;

/**
 * Whether a field must be filled. "required" sets aria-required on the
 * control; "optional" adds a muted "(optional)" to the label. Left out (a
 * checkbox, a toggle), the field is marked neither way.
 */
export type FieldRequirement = "required" | "optional";

type FormFieldContextValue = {
  name: string;
  errors: FormFieldError[];
  requirement?: FieldRequirement;
};

const FormFieldContext = React.createContext<FormFieldContextValue | undefined>(undefined);

type FormItemContextValue = { id: string };
const FormItemContext = React.createContext<FormItemContextValue | undefined>(undefined);

export const useFormField = () => {
  const field = React.useContext(FormFieldContext);
  const item = React.useContext(FormItemContext);
  if (!field) {
    throw new Error("useFormField must be used inside a <FormField>");
  }
  if (!item) {
    throw new Error("useFormField must be used inside a <FormItem>");
  }
  const firstError = field.errors[0];
  const error =
    firstError === undefined
      ? undefined
      : typeof firstError === "string"
        ? { message: firstError }
        : firstError;
  return {
    id: item.id,
    name: field.name,
    formItemId: `${item.id}-form-item`,
    formDescriptionId: `${item.id}-form-item-description`,
    formMessageId: `${item.id}-form-item-message`,
    error,
    requirement: field.requirement,
  };
};

export type FormFieldProps = {
  name: string;
  errors: FormFieldError[] | undefined;
  requirement?: FieldRequirement;
  children: React.ReactNode;
};

export function FormField({ name, errors, requirement, children }: FormFieldProps) {
  const value = React.useMemo(
    () => ({ name, errors: errors ?? [], requirement }),
    [name, errors, requirement],
  );
  return <FormFieldContext.Provider value={value}>{children}</FormFieldContext.Provider>;
}

export function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  const value = React.useMemo(() => ({ id }), [id]);
  return (
    <FormItemContext.Provider value={value}>
      <div data-slot="form-item" className={cn("grid gap-1.5", className)} {...props} />
    </FormItemContext.Provider>
  );
}

export function FormLabel({ className, children, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId, requirement } = useFormField();
  return (
    <Label
      data-slot="form-label"
      id={`${formItemId}-label`}
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      {requirement === "optional" ? (
        <>
          {" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </>
      ) : null}
    </Label>
  );
}

export function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId, requirement } = useFormField();
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      aria-required={requirement === "required" ? true : undefined}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function FormMessage({ className, children, role, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error?.message ?? children;
  // Always rendered, one line tall when empty: an error then fills a line
  // that was already there instead of pushing the form down.
  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("min-h-5 text-sm text-destructive", className)}
      // An empty slot is not an alert; the role arrives with the message.
      role={body ? role : undefined}
      {...props}
    >
      {body}
    </p>
  );
}
