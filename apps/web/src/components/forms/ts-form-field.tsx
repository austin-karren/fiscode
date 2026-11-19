import { FormField, type FieldRequirement } from "@fiscode/ui/components/form";
import type { AnyFieldApi } from "@tanstack/react-form";
import type { ReactNode } from "react";
import type { ZodTypeAny } from "zod";

/**
 * A blur validator: a zod schema, or a function for a rule that reads another
 * field (`fieldApi.form.getFieldValue`). It returns the message, or nothing.
 */
export type BlurValidator =
  | ZodTypeAny
  | ((args: { value: any; fieldApi: AnyFieldApi }) => string | undefined);

// Bridges TanStack Form's `form.Field` render-prop API into shadcn's Form
// context. Inside `children`, render `<FormItem>` / `<FormLabel>` /
// `<FormControl>` / `<FormMessage>` like normal — they pick up the error
// state from the surrounding TanStack field via context.
//
// Optional `validators` prop is forwarded to `form.Field`. Per the project
// rule on form validation timing, per-field validators should run on
// `onBlur` only — never on `onChange` — so the user doesn't see
// mid-keystroke errors. The form-level validator stays on `onSubmit`.
//
// `form` is loosely typed because the TanStack form generic surface has 12
// type parameters; constraining it in the bridge gives no benefit and a lot
// of friction. Callers still get full type safety on `field.state.value`
// because the field arg uses TanStack's own inference.
//
// `error` adds a message from outside the form's validators (a save the repo
// refused). It marks the field invalid and shows under it, but unlike a
// validator error it does not disable submit; the caller clears it.
export function TSFormField({
  form,
  name,
  validators,
  error,
  requirement,
  children,
}: {
  form: any;
  name: string;
  validators?: { onBlur?: BlurValidator };
  error?: string;
  /** "required" or "optional"; leave out for a checkbox. See FormField. */
  requirement?: FieldRequirement;
  children: (field: AnyFieldApi) => ReactNode;
}) {
  const FieldComp = form.Field as React.ComponentType<{
    name: string;
    validators?: { onBlur?: BlurValidator };
    children: (field: AnyFieldApi) => ReactNode;
  }>;
  return (
    <FieldComp name={name} validators={validators}>
      {(field: AnyFieldApi) => (
        <FormField
          name={field.name}
          requirement={requirement}
          errors={[
            ...(error ? [{ message: error }] : []),
            ...(field.state.meta.errors as Array<{ message?: string } | string>),
          ]}
        >
          {children(field)}
        </FormField>
      )}
    </FieldComp>
  );
}
