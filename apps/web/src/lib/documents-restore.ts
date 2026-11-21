import { folderRepo, type DocumentFolderRow } from "./documents-stub";
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
