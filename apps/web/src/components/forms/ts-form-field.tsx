import { FormField } from "@fiscode/ui/components/form";
import type { AnyFieldApi } from "@tanstack/react-form";
import type { ReactNode } from "react";
import type { ZodTypeAny } from "zod";

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
export function TSFormField({
  form,
  name,
  validators,
  children,
}: {
  form: any;
  name: string;
  validators?: { onBlur?: ZodTypeAny };
  children: (field: AnyFieldApi) => ReactNode;
}) {
  const FieldComp = form.Field as React.ComponentType<{
    name: string;
    validators?: { onBlur?: ZodTypeAny };
    children: (field: AnyFieldApi) => ReactNode;
  }>;
  return (
    <FieldComp name={name} validators={validators}>
      {(field: AnyFieldApi) => (
        <FormField
          name={field.name}
          errors={field.state.meta.errors as Array<{ message?: string } | string>}
        >
          {children(field)}
        </FormField>
      )}
    </FieldComp>
  );
}
