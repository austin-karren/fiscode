import { isBeforeSeStart } from "@fiscode/core";

/**
 * The placed-in-service date an expense form saves. Only equipment has one. A
 * date the user picked wins. Otherwise equipment bought before the SE start is
 * placed in service on the SE start (Pub 946: property converted to business
 * use is placed in service "on the date of the change"), so the form shows that
 * date and saves it. Equipment bought on or after the start needs none: it is
 * placed in service when bought.
 */
export const placedInServiceFor = (
  category: string,
  purchaseDate: string | undefined,
  entered: string | undefined,
  seStartDate: string | null | undefined,
): string | null => {
  if (category !== "equipment") return null;
  if (entered) return entered;
  if (purchaseDate && isBeforeSeStart(purchaseDate, seStartDate)) return seStartDate!;
  return null;
};
