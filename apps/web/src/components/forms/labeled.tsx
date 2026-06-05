import { FormLabel } from "@fiscode/ui/components/form";
import { cn } from "@fiscode/ui/lib/utils";
import type { ReactNode } from "react";

import { InfoTooltip } from "../info-tooltip";

// shadcn FormLabel with an inline info tooltip beside the text. Use anywhere
// a label benefits from a one-sentence explanation of the underlying term.
export function LabelWithTooltip({
  children,
  tooltip,
  className,
}: {
  children: ReactNode;
  tooltip: ReactNode;
  className?: string;
}) {
  return (
    <FormLabel className={cn("inline-flex items-center gap-1.5", className)}>
      {children}
      <InfoTooltip text={tooltip} />
    </FormLabel>
  );
}
