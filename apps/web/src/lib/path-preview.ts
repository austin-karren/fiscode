import type { folderRepo } from "@fiscode/db";

/** What a preview returns: the path a save would write, and whether it fits (#108). */
export type PathPreview = Awaited<ReturnType<typeof folderRepo.previewPath>>;

// Words for a path preview (vault PR 8b): where a save would put a file or folder.

/** "Too long by 12 characters", or, when even the shortest title can't fit, that. */
export const tooLongLine = (p: Pick<PathPreview, "overBy">): string =>
  p.overBy > 0
    ? `Too long by ${p.overBy} ${p.overBy === 1 ? "character" : "characters"}. Use a shorter name.`
    : "Too long to fit, even shortened. Use a shorter name or a folder nearer the top.";

/** "Saves as documents/2026/Expenses/…", or the too-long line. */
export const previewLine = (p: PathPreview): string =>
  p.fits ? `Saves as ${p.path}` : tooLongLine(p);
