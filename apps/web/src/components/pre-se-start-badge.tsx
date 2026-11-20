import { AlertTriangle } from "lucide-react";

import { isBeforeSeStart } from "@fiscode/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "@fiscode/ui/components/tooltip";
import { formatDate } from "../lib/format-date";

// Small warning chip rendered next to a row's date when that date is
// before the user's self-employment start date. The tax engine excludes
// pre-SE rows from the estimate; this lets users see which rows aren't
// being counted without digging through the dashboard banner.
export function PreSeStartBadge({
  rowDate,
  seStartDate,
  startupHint = false,
}: {
  rowDate: string;
  seStartDate: string | null | undefined;
  // Expenses only: a cost before the start can still count as a startup cost.
  startupHint?: boolean;
}) {
  if (!isBeforeSeStart(rowDate, seStartDate)) return null;
  const why = `Not counted in the tax estimate: dated before your start date, ${formatDate(seStartDate!)}.${
    startupHint ? " Tick Startup expense if it was a startup cost." : ""
  }`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={why}
            className="inline-flex items-center text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-3.5" />
          </span>
        }
      />
      <TooltipContent>{why}</TooltipContent>
    </Tooltip>
  );
}
