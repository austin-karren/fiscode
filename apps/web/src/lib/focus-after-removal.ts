import { MAIN_ID } from "./nav";

/**
 * Where focus goes once the row holding `from` (a row's Delete button) is
 * removed, so it does not fall to the page body: the next row's first
 * control, else the previous row's; with no other row, a list itself (it
 * stays, saying there are none), and for a table the page's main region (the
 * table gives way to an empty state). Call it before the delete; run what it returns after the
 * rows have re-rendered. Rows are keyed, so the other rows' elements survive.
 */
export function focusAfterRemoval(from: HTMLElement): () => void {
  const row = from.closest("tr, li");
  const next = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
  const list = row?.closest("table, ul") ?? null;
  return () => {
    // Resolved a frame later, once React has committed the re-render: the
    // last row's table may be replaced by an empty state only then.
    requestAnimationFrame(() => {
      const control =
        next?.isConnected === true ? next.querySelector<HTMLElement>("button, a[href]") : null;
      // With no other row, a table gives way to its empty state (so focus
      // goes to main); a list stays, showing its "none" line.
      const keepsList = list?.tagName === "UL" && list.isConnected;
      const target =
        control ?? (keepsList ? (list as HTMLElement) : document.getElementById(MAIN_ID));
      if (!target) return;
      if (target !== control && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus();
    });
  };
}

/**
 * Like focusAfterRemoval, for a dialog's finalFocus: resolves the element to focus once the row
 * holding `from` may have gone. `from` itself while it is still there (its row stayed, as in
 * search results), else the next row's first control, else the previous row's, else `fallback`.
 * Capture it before the change.
 */
export function targetAfterRemoval(
  from: HTMLElement,
  fallback: () => HTMLElement | null,
): () => HTMLElement | null {
  const row = from.closest("tr, li");
  const next = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
  return () => {
    if (from.isConnected) return from;
    const control =
      next?.isConnected === true ? next.querySelector<HTMLElement>("button, a[href]") : null;
    return control ?? fallback();
  };
}
