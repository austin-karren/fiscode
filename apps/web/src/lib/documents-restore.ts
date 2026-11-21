import { documentRepo, folderRepo } from "@fiscode/db";
import type { DocumentFolderRow, DocumentRow } from "@fiscode/csv";
import { folderPath } from "./documents-view";

// A restore never fails: a taken name comes back as "Name (2)" and a gone parent as the year's
// root or the top (#84). Say so when that happened; otherwise just "Restored".
export async function landedLine(before: DocumentFolderRow): Promise<string> {
  const after = await folderRepo.get(before.id);
  if (!after) return `Restored ${before.name}.`;
  const all = await folderRepo.list();
  const renamed = after.name !== before.name;
  const moved = after.parentId !== before.parentId;
  if (!renamed && !moved) return `Restored ${before.name}.`;
  const where = after.parentId ? folderPath(all, after.parentId) : "the top level";
  return renamed
    ? `Restored ${before.name} as ${after.name} in ${where}.`
    : `Restored ${before.name} in ${where}: its folder is gone.`;
}

/**
 * Restores a document from Trash. If its folder is in Trash too, the document goes to the nearest
 * folder above it that isn't (or Unfiled), so it never lands somewhere no one can see, and the line
 * says so.
 */
export async function restoreDocument(doc: DocumentRow): Promise<string> {
  const all = await folderRepo.listIncludingDeleted();
  const live = all.filter((f) => f.deletedAt === null);
  let target = doc.folderId;
  while (target && !live.some((f) => f.id === target)) {
    target = all.find((f) => f.id === target)?.parentId ?? null;
  }
  await documentRepo.revertTo(doc.id, { ...doc, deletedAt: null, folderId: target });
  if (target === doc.folderId) return `Restored ${doc.name}.`;
  return `Restored ${doc.name} in ${target ? folderPath(live, target) : "Unfiled"}: its folder is in Trash.`;
}
