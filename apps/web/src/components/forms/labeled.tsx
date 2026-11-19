import { FormDescription, FormLabel } from "@fiscode/ui/components/form";
import type { ReactNode } from "react";

import { InfoTooltip } from "../info-tooltip";

// shadcn FormLabel with an inline info tooltip beside the text. Use anywhere
// a label benefits from a one-sentence explanation of the underlying term.
//
// The tooltip button sits beside the <label>, not inside it: a label's
// content becomes the control's accessible name, and a button inside would
// turn "Entity type" into "Entity type More info". `className` styles the
// label text.
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
    <span className="inline-flex items-center gap-1.5">
      <FormLabel className={className}>{children}</FormLabel>
      <InfoTooltip text={tooltip} />
      {/* The hint as the field's description, so a screen reader reads it on
          the field itself (FormControl's aria-describedby names this id). */}
      <FormDescription className="sr-only">{tooltip}</FormDescription>
    </span>
  );
}
