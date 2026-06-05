import { CSV_SCHEMA_VERSION } from "./schema.ts";

export type Provenance = {
  exportedAt: string; // ISO 8601 UTC
  scope: "full" | "yearly";
  year?: number;
};

export const SOURCE_URL = "https://fiscode.austink.dev";

/**
 * Build the `#`-prefixed provenance header lines that precede CSV data.
 * Excel will not strip these — the import path must.
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
  lines.push("# note: import at the source URL to reconstruct full local state.");
  lines.push("# warning: Excel will not strip these header lines. The fiscode importer does.");
  return lines.join("\n") + "\n";
};

const HEADER_PREFIX = "#";

/**
 * Parse the provenance lines off the top of a CSV. Returns the stripped CSV
 * body plus the parsed metadata. Unknown header keys are ignored.
 */
export const parseProvenance = (raw: string): { body: string; provenance: Partial<Provenance> } => {
  const lines = raw.split(/\r?\n/);
  const meta: Partial<Provenance> = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith(HEADER_PREFIX)) {
      bodyStart = i;
      break;
    }
    const trimmed = line.slice(1).trim();
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key === "exported") meta.exportedAt = value;
    else if (key === "scope") {
      if (value === "full" || value === "yearly") meta.scope = value;
    } else if (key === "year") {
      const n = Number(value);
      if (Number.isFinite(n)) meta.year = n;
    }
  }
  return {
    body: lines.slice(bodyStart).join("\n"),
    provenance: meta,
  };
};
