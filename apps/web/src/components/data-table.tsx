import type { ReactNode } from "react";

// Compound table primitive. Composition over prop-driven config.
//
// Narrower than @2xl (a phone), each row stacks as a small card: one line per
// cell, its column label (the Cell's `label`) on the left and the value on the
// right, the row's actions on a line of their own. Nothing scrolls sideways
// and every action stays on screen. Wider, it is a plain table.
//
// Screen readers: stacking sets `display: block`, which drops the implicit
// table roles in Chromium and Safari, so every part carries its role
// explicitly. The header row stays in the accessibility tree (sr-only, not
// display:none), so cells are still announced with their column header; the
// visible per-cell label is aria-hidden so it is not read twice.
export function DataTable({ children }: { children: ReactNode }) {
  return (
    // relative: visually hidden text inside a row (record names on its
    // buttons, the stacked header row) is absolutely positioned and must stay
    // inside this scroll box, or the page itself scrolls sideways on a phone.
    <div className="@container relative overflow-x-auto rounded-md border border-border">
      <table role="table" className="w-full border-collapse text-sm @max-2xl:block">
        {children}
      </table>
    </div>
  );
}

function THead({ children }: { children: ReactNode }) {
  return (
    <thead
      role="rowgroup"
      className="border-b border-border bg-muted/40 text-muted-foreground @max-2xl:sr-only"
    >
      {children}
    </thead>
  );
}

function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody role="rowgroup" className="@max-2xl:block">
      {children}
    </tbody>
  );
}

function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr
      role="row"
      className={`border-b border-border/40 last:border-b-0 @max-2xl:block @max-2xl:py-2 ${className}`}
    >
      {children}
    </tr>
  );
}

function TH({ children, align = "left" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      role="columnheader"
      className={`px-3 py-2 font-medium text-xs uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TD({
  children,
  align = "left",
  className = "",
  label,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  /** The column's name, shown beside the value when rows stack on a phone. Omit for the actions cell. */
  label?: string;
}) {
  return (
    <td
      role="cell"
      data-label={label}
      className={`px-3 py-2 align-top ${
        align === "right" ? "text-right tabular-nums" : ""
      } @max-2xl:flex @max-2xl:items-start @max-2xl:gap-4 @max-2xl:py-1 @max-2xl:text-right ${
        label ? "@max-2xl:justify-between" : "@max-2xl:justify-end"
      } ${className}`}
    >
      {label ? (
        <span
          aria-hidden="true"
          className="hidden shrink-0 text-left text-muted-foreground @max-2xl:inline"
        >
          {label}
        </span>
      ) : null}
      {children}
    </td>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <tr role="row" className="@max-2xl:block">
      <td
        role="cell"
        colSpan={99}
        className="px-3 py-6 text-center text-sm text-muted-foreground @max-2xl:block"
      >
        {message}
      </td>
    </tr>
  );
}

DataTable.Head = THead;
DataTable.Body = TBody;
DataTable.Row = TR;
DataTable.HeaderCell = TH;
DataTable.Cell = TD;
DataTable.Empty = Empty;
