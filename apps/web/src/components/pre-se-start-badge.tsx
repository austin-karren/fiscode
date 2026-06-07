import { AlertTriangle } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@fiscode/ui/components/tooltip";

// Small warning chip rendered next to a row's date when that date is
// before the user's self-employment start date. The tax engine excludes
// pre-SE rows from the estimate; this lets users see which rows aren't
// being counted without digging through the dashboard banner.
export function PreSeStartBadge({
  rowDate,
  seStartDate,
}: {
  rowDate: string;
  seStartDate: string | null | undefined;
}) {
  if (!seStartDate || rowDate >= seStartDate) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label="Excluded from tax estimate — dated before your SE start"
            className="inline-flex items-center text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-3.5" />
          </span>
        }
      />
      <TooltipContent>
        Excluded from the tax estimate — dated before your SE start ({seStartDate}).
      </TooltipContent>
    </Tooltip>
  );
}
