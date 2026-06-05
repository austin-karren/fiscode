import { useEffect, type RefObject } from "react";

// Enter submits the bound form when focus is not in a typing surface.
// Browsers already submit a form when Enter is pressed inside a single-line
// <input>; this covers the cases that browser default doesn't (focus on the
// document body, a button, a checkbox, a popover trigger, etc).
export function useSubmitOnEnter(formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const form = formRef.current;
      if (!form) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
        // Let combobox / listbox / menu handle their own Enter (selection).
        const role = target.getAttribute("role");
        if (role === "combobox" || role === "listbox" || role === "option" || role === "menuitem")
          return;
        // Don't intercept Enter on the submit button itself — its own click
        // handler will submit the form.
        if (tag === "BUTTON" && (target as HTMLButtonElement).type === "submit") return;
        // Only fire if focus is inside this form (or on the body).
        if (target !== document.body && !form.contains(target) && target.tagName !== "BODY") return;
      }

      e.preventDefault();
      form.requestSubmit();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [formRef]);
}
