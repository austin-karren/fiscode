import { MAIN_ID } from "./nav";

/**
 * Where focus goes once the row holding `from` (a row's Delete button) is
 * removed, so it does not fall to the page body: the next row's first
 * control, else the previous row's, else the table or list itself, else the
 * page's main region. Call it before the delete; run what it returns after the
 * rows have re-rendered. Rows are keyed, so the other rows' elements survive.
 */
export function focusAfterRemoval(from: HTMLElement): () => void {
  const row = from.closest("tr, li");
  const next = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
  const list = row?.closest("table, ul") ?? null;
  return () => {
    const control =
      next?.isConnected === true ? next.querySelector<HTMLElement>("button, a[href]") : null;
    const target =
      control ?? (list?.isConnected ? (list as HTMLElement) : document.getElementById(MAIN_ID));
    if (!target) return;
    if (target !== control && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus();
  };
}
