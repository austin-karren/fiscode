import type { ReactNode } from "react";
import { cn } from "@fiscode/ui/lib/utils";

export function Page({
  title,
  description,
  children,
  actions,
  printHeader,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Replaces the screen header on paper. */
  printHeader?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 print:max-w-none">
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
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2 print:hidden">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
