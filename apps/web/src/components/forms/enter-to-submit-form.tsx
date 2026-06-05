import { useRef, type ComponentProps } from "react";

import { useSubmitOnEnter } from "../../hooks/use-submit-on-enter";

// Drop-in <form> replacement that also submits when Enter is pressed while
// focus is outside any typing surface (body, a popover trigger, a checkbox,
// etc). Standard Enter-in-input behavior is unchanged.
export function EnterToSubmitForm(props: ComponentProps<"form">) {
  const ref = useRef<HTMLFormElement>(null);
  useSubmitOnEnter(ref);
  return <form ref={ref} {...props} />;
}
