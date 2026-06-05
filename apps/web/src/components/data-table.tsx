import type { ReactNode } from "react";

// Compound table primitive. Composition over prop-driven config.
export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-muted/40 text-muted-foreground">{children}</thead>
  );
}

function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

function TR({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-border/40 last:border-b-0 ${className}`}>{children}</tr>;
}

function TH({ children, align = "left" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th
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
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={99} className="px-3 py-6 text-center text-sm text-muted-foreground">
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
