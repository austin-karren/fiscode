import { formatUSD } from "@fiscode/core";
import type { StatePrepayment } from "@fiscode/tax";
import { formatDate } from "../lib/format-date";

/**
 * Utah's prepayment minimum (TC-546). When it is $0, TC-546 line 8 says "a
 * payment is not due at this time", so the line says so instead of "$0.00".
 */
export function UtahPrepaymentLine({ prepayment }: { prepayment: StatePrepayment }) {
  // The shared date format, so every date on the dashboard reads the same.
  const due = formatDate(prepayment.dueDate);
  // The return is due April 15 after the tax year, so last year is two years before the due date.
  const lastYear = Number(prepayment.dueDate.slice(0, 4)) - 2;
  // Which TC-546 line 5 amount was used: line 4 (last year's Utah tax) or line 3 (90% of this year's).
  const basis =
    prepayment.basis === "priorYear"
      ? `your ${lastYear} Utah tax, which is less than 90% of this year's, less Utah withholding`
      : "90% of this year's Utah tax, less Utah withholding";
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      {prepayment.minimum > 0
        ? `Utah: pay at least ${formatUSD(prepayment.minimum)} by ${due} (${basis}).`
        : `Utah: no prepayment due by ${due}.`}
    </p>
  );
}
