import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@fiscode/ui/components/tooltip";
import { cn } from "@fiscode/ui/lib/utils";

// Small "(i)" info button next to a label. Tooltip opens on hover (desktop)
// and on focus/tap (mobile). Renders as a button so it doesn't steal click
// focus from a parent <label>.
export function InfoTooltip({
  text,
  className,
  side = "top",
  ariaLabel = "More info",
}: {
  text: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  ariaLabel?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              className,
            )}
            aria-label={ariaLabel}
          >
            <Info className="size-3.5" />
          </button>
        }
      />
      <TooltipContent side={side} className="max-w-xs text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
