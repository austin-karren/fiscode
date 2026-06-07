import { useEffect, type RefObject } from "react";

// Enter submits the bound form when focus is not in a typing surface.
// Browsers already submit a form when Enter is pressed inside a single-line
// <input>; this covers the cases that browser default doesn't (focus on the
// document body, a button, a checkbox, a popover trigger, etc).
export function useSubmitOnEnter(formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      // Respect any component that already handled Enter (Base UI combobox,
      // select, dialog, etc. all preventDefault on Enter in their own ways).
      if (e.defaultPrevented) return;
      const form = formRef.current;
      if (!form) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        // Browser already submits the form when Enter is pressed in a single-
        // line <input>. Don't double-fire here.
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
        // Composite widgets handle their own Enter (selection, toggle, etc.).
        const role = target.getAttribute("role");
        if (role === "combobox" || role === "listbox" || role === "option" || role === "menuitem")
          return;
        // ANY button (submit, popover trigger, select trigger, icon button) —
        // browser already invokes .click() on Enter for a focused button. Hook
        // would double-fire and bypass the button's own handler.
        if (tag === "BUTTON") return;
        // Only fire when focus is inside this form or on the document body.
        if (target !== document.body && !form.contains(target) && target.tagName !== "BODY") return;
      }

      e.preventDefault();
      form.requestSubmit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [formRef]);
}
