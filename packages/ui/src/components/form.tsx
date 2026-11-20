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

type FormItemContextValue = {
  id: string;
  /** Whether a FormDescription is rendered in this item. */
  described: boolean;
  setDescribed: (described: boolean) => void;
};
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
    described: item.described,
    setDescribed: item.setDescribed,
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
  const [described, setDescribed] = React.useState(false);
  const value = React.useMemo(() => ({ id, described, setDescribed }), [id, described]);
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
      {requirement === "optional" ? (
        // One run of inline text, not separate flex items (label text and
        // marker), so a long label wraps as words.
        <span>
          <WithOptionalMarker>{children}</WithOptionalMarker>
        </span>
      ) : (
        children
      )}
    </Label>
  );
}

const optionalMarker = <span className="font-normal text-muted-foreground">(optional)</span>;

// "(optional)" wraps as one unit with the label's last word ("Placed in /
// service (optional)"): both sit in a nowrap span. The space between them is
// mid-span, not leading, so the accessible name keeps it.
function WithOptionalMarker({ children }: { children: React.ReactNode }) {
  if (typeof children !== "string") {
    return (
      <>
        {children} {optionalMarker}
      </>
    );
  }
  const cut = children.trimEnd().lastIndexOf(" ");
  const head = children.slice(0, cut + 1);
  const lastWord = children.slice(cut + 1).trimEnd();
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {lastWord} {optionalMarker}
      </span>
    </>
  );
}

export function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId, requirement, described } =
    useFormField();
  // Only ids that are on the page: the description when the item has one,
  // the message when it holds an error.
  const describedBy = [described ? formDescriptionId : null, error ? formMessageId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={describedBy || undefined}
      aria-invalid={!!error}
      aria-required={requirement === "required" ? true : undefined}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId, setDescribed } = useFormField();
  // Tells the item's control it may name this description. This registers a
  // rendered element with its item; it does not derive state from props.
  React.useLayoutEffect(() => {
    setDescribed(true);
    return () => setDescribed(false);
  }, [setDescribed]);
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
