import { documentRepo, type DocumentRow } from "./documents-stub";
import { errorLine } from "./documents-view";

export type UploadResult = { name: string; ok: boolean; line: string };

/**
 * Uploads `files` into a folder. Every file gets its own result line, and one refused file never
 * stops the rest. `duplicates` pairs each upload whose bytes were already here with the first
 * document that had them (the bytes are stored once; the screen says so in a toast).
 */
export async function uploadFiles(
  files: File[],
  folderId: string | null,
  existing: DocumentRow[],
): Promise<{ results: UploadResult[]; duplicates: { added: DocumentRow; first: DocumentRow }[] }> {
  const known = new Map(existing.filter((d) => d.deletedAt === null).map((d) => [d.sha256, d]));
  const { ok, failed } = await documentRepo.uploadMany(files, { folderId });
  return {
    results: [
      ...ok.map((d) => ({ name: d.name, ok: true, line: `Added ${d.name}.` })),
      ...failed.map((f) => ({ name: f.name, ok: false, line: errorLine(f.error) })),
    ],
    duplicates: ok.flatMap((added) => {
      const first = known.get(added.sha256);
      return first ? [{ added, first }] : [];
    }),
  };
}
