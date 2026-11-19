import type { ReactNode } from "react";
import { cn } from "@fiscode/ui/lib/utils";

/**
 * A card's or section's title: a small uppercase label, tracked out so the
 * capitals read as a label rather than a shout, in muted text. One element of
 * its own, so CardTitle keeps its slot styles. An info tooltip may follow the
 * text inside it.
 */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}
