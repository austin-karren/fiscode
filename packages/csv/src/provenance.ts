import { CSV_SCHEMA_VERSION } from "./schema.ts";

export type Provenance = {
  scope: "full" | "yearly";
  year?: number;
  /** The file's `schema:` marker, e.g. `v1` or `v2`. Read on import only. */
  schema?: string;
  /** Export time. Only v1 files carry one; v2 files hold nothing that varies by time. */
  exportedAt?: string;
};

export const SOURCE_URL = "https://fiscode.app";

/**
 * The UTF-8 byte-order mark (U+FEFF), written first in every export. Excel
 * reads a CSV without it in the local code page, which turns é or § into
 * mojibake. Sheets and Numbers accept it too. Built from its code so the
 * source never holds the invisible character itself.
 */
export const BOM = String.fromCharCode(0xfeff);

export const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

/** Record separator for exports (RFC 4180). The importer also reads bare LF. */
export const EOL = "\r\n";

/**
 * Build the two `#`-prefixed lines that open an export. A spreadsheet shows
 * them as text in column A; the importer skips them.
 *
 * Nothing here may vary by export time or machine: two exports of the same
 * state must be the same bytes. Keep commas and quotes out of these lines so a
 * spreadsheet saves them back unquoted.
 */
export const buildProvenance = (p: Pick<Provenance, "scope" | "year">): string => {
  const facts = [`schema: ${CSV_SCHEMA_VERSION}`, `scope: ${p.scope}`];
  if (p.scope === "yearly" && p.year !== undefined) facts.push(`year: ${p.year}`);
  return [
    `# fiscode export (${facts.join("; ")})`,
    `# Money is in dollars. Dates are YYYY-MM-DD. Import this file at ${SOURCE_URL} to restore it.`,
  ]
    .map((line) => line + EOL)
    .join("");
};

const HEADER_PREFIX = "#";

// `key: value` pairs. A v2 line holds several, split by `;` inside brackets.
// A v1 line holds one, and its value may contain colons (a timestamp).
const FACT = /([a-z_]+):\s*([^;)]*)/g;

/**
 * Read provenance out of comment lines (each starting with `#`), v1 or v2.
 * Unknown keys and lines without a `key: value` pair are ignored.
 */
export const parseProvenanceLines = (lines: readonly string[]): Partial<Provenance> => {
  const meta: Partial<Provenance> = {};
  for (const line of lines) {
    for (const [, key, rawValue] of line.matchAll(FACT)) {
      const value = rawValue!.trim();
      if (key === "exported") meta.exportedAt = value;
      else if (key === "schema") meta.schema = value;
      else if (key === "scope") {
        if (value === "full" || value === "yearly") meta.scope = value;
      } else if (key === "year") {
        const n = Number(value);
        if (value !== "" && Number.isFinite(n)) meta.year = n;
      }
    }
  }
  return meta;
};

/**
 * Parse the provenance lines off the top of a CSV. Returns the stripped CSV
 * body plus the parsed metadata.
 */
export const parseProvenance = (raw: string): { body: string; provenance: Partial<Provenance> } => {
  const lines = stripBom(raw).split(/\r?\n/);
  let bodyStart = lines.findIndex((line) => !line.startsWith(HEADER_PREFIX));
  if (bodyStart === -1) bodyStart = lines.length;
  return {
    body: lines.slice(bodyStart).join("\n"),
    provenance: parseProvenanceLines(lines.slice(0, bodyStart)),
  };
};
