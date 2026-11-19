import type { ReactNode } from "react";
import { cn } from "@fiscode/ui/lib/utils";

// How wide a screen runs, by what it holds: tables, lists and summaries use
// the full width; a settings form reads better narrower; a short form (setup)
// narrower still.
const WIDTHS = {
  wide: "max-w-6xl",
  form: "max-w-2xl",
  narrow: "max-w-md",
} as const;

export function Page({
  title,
  description,
  children,
  actions,
  printHeader,
  width = "wide",
}: {
  title: string;
  width?: keyof typeof WIDTHS;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Replaces the screen header on paper. */
  printHeader?: ReactNode;
}) {
  return (
    // A query container: the cards inside lay out by the page's width.
    <div
      className={cn(
        "@container mx-auto flex w-full flex-col gap-6 print:max-w-none",
        WIDTHS[width],
      )}
    >
      {printHeader ? (
        <header data-testid="print-header" className="hidden print:block">
          {printHeader}
        </header>
      ) : null}
      <header
        className={cn(
          "flex flex-wrap items-end justify-between gap-3",
          printHeader ? "print:hidden" : null,
        )}
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2 print:hidden">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
