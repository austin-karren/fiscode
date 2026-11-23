import { documentRepo } from "@fiscode/db";
import type { DocumentRow } from "@fiscode/csv";
import { errorLine } from "./documents-view";

export type UploadResult = {
  name: string;
  ok: boolean;
  line: string;
  /** When the bytes were already here: the document that first had them. */
  sameAs?: DocumentRow;
  /** The document this file became, when it was added. */
  doc?: DocumentRow;
};

/**
 * Uploads `files` into a folder. Every file gets its own result line, and one refused file never
 * stops the rest. When a file's bytes are already here (in any folder, or earlier in this same
 * batch), they are stored once and its line says which document and folder had them first.
 */
export async function uploadFiles(
  files: File[],
  folderId: string | null,
  existing: DocumentRow[],
  pathOf: (folderId: string | null) => string,
): Promise<UploadResult[]> {
  const known = new Map(existing.filter((d) => d.deletedAt === null).map((d) => [d.sha256, d]));
  const { ok, failed } = await documentRepo.uploadMany(files, { folderId });
  const added = ok.map((d): UploadResult => {
    const first = known.get(d.sha256);
    // Where the file landed in the vault folder (§ 11.5): the date and a " (n)" may be added.
    const added = d.vaultPath ? `Added ${d.name} at ${d.vaultPath}` : `Added ${d.name}`;
    if (!first) {
      known.set(d.sha256, d);
      return { name: d.name, ok: true, line: `${added}.`, doc: d };
    }
    return {
      name: d.name,
      ok: true,
      line: `${added}: the same file as ${first.name} in ${pathOf(first.folderId)}.`,
      sameAs: first,
      doc: d,
    };
  });
  return [...added, ...failed.map((f) => ({ name: f.name, ok: false, line: errorLine(f.error) }))];
}
