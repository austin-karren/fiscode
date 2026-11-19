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
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      {prepayment.minimum > 0
        ? `Utah: pay at least ${formatUSD(prepayment.minimum)} by ${due} (90% of this year's Utah tax, less Utah withholding).`
        : `Utah: no prepayment due by ${due}.`}
    </p>
  );
}
