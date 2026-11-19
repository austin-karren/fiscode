import { useRef, type ComponentProps, type KeyboardEvent } from "react";

import { useSubmitOnEnter } from "../../hooks/use-submit-on-enter";

const NOT_TYPED_IN = new Set(["checkbox", "radio", "button", "submit", "reset", "file"]);

// Drop-in <form> replacement that also submits when Enter is pressed while
// focus is outside any typing surface (body, a popover trigger, a checkbox,
// etc).
//
// Enter inside a text input submits too, but not through the browser: the
// browser skips its own submit while the submit button is disabled, and the
// button is disabled while any field shows an error. A field only re-checks
// its value on blur, so a corrected value would stay stuck behind its old
// error. Enter therefore counts as "done with this field": the input is
// blurred and focused again, which re-runs its blur validator, and then the
// form is submitted.
export function EnterToSubmitForm({ onKeyDown, ...props }: ComponentProps<"form">) {
  const ref = useRef<HTMLFormElement>(null);
  useSubmitOnEnter(ref);

  const submitFromInput = (e: KeyboardEvent<HTMLFormElement>) => {
    onKeyDown?.(e);
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    // A combobox or other widget that used Enter itself has prevented default.
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || NOT_TYPED_IN.has(target.type)) return;
    if (target.getAttribute("role") === "combobox") return;

    e.preventDefault();
    target.blur();
    target.focus();
    ref.current?.requestSubmit();
  };

  return <form ref={ref} onKeyDown={submitFromInput} {...props} />;
}
