import { CSV_SCHEMA_VERSION } from "./schema.ts";

export type Provenance = {
  exportedAt: string; // ISO 8601 UTC
  scope: "full" | "yearly";
  year?: number;
  /** The file's `# schema:` marker, e.g. `v1` or `v2`. Read on import only. */
  schema?: string;
};

export const SOURCE_URL = "https://fiscode.app";

/** Record separator for exports (RFC 4180). The importer also reads bare LF. */
export const EOL = "\r\n";

/**
 * Build the `#`-prefixed provenance header lines that precede CSV data.
 * A spreadsheet shows them as text in column A; the importer skips them.
 * Keep commas and quotes out of these lines so a spreadsheet saves them back
 * unquoted.
 */
export const buildProvenance = (p: Provenance): string => {
  const lines = [
    "# fiscode export",
    `# source: ${SOURCE_URL}`,
    `# schema: ${CSV_SCHEMA_VERSION}`,
    `# exported: ${p.exportedAt}`,
    `# scope: ${p.scope}`,
  ];
  if (p.scope === "yearly" && p.year !== undefined) {
    lines.push(`# year: ${p.year}`);
  }
  lines.push(
    "# Money is in dollars. Dates are YYYY-MM-DD. Import this file at the source URL to restore it.",
  );
  return lines.join(EOL) + EOL;
};

const HEADER_PREFIX = "#";

/**
 * Read provenance out of comment lines (each starting with `#`). Unknown keys
 * and lines without a `key: value` shape are ignored.
 */
export const parseProvenanceLines = (lines: readonly string[]): Partial<Provenance> => {
  const meta: Partial<Provenance> = {};
  for (const line of lines) {
    const trimmed = line.slice(HEADER_PREFIX.length).trim();
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key === "exported") meta.exportedAt = value;
    else if (key === "schema") meta.schema = value;
    else if (key === "scope") {
      if (value === "full" || value === "yearly") meta.scope = value;
    } else if (key === "year") {
      const n = Number(value);
      if (Number.isFinite(n)) meta.year = n;
    }
  }
  return meta;
};

/**
 * Parse the provenance lines off the top of a CSV. Returns the stripped CSV
 * body plus the parsed metadata.
 */
export const parseProvenance = (raw: string): { body: string; provenance: Partial<Provenance> } => {
  const lines = raw.replace(/^﻿/, "").split(/\r?\n/);
  let bodyStart = lines.findIndex((line) => !line.startsWith(HEADER_PREFIX));
  if (bodyStart === -1) bodyStart = lines.length;
  return {
    body: lines.slice(bodyStart).join("\n"),
    provenance: parseProvenanceLines(lines.slice(0, bodyStart)),
  };
};
