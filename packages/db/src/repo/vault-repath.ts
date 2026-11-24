import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../client.ts";
import { document, meta, type DocumentRow } from "../schema/index.ts";
import { addedDay, byAdded, documentDate } from "../vault/paths.ts";
import { changeTree, ownDatePrefix, previewDocumentPath, type RunHooks } from "./document-tree.ts";
import { linkedDates } from "./documents.ts";

/** Set to "done" in `meta` once every file has the path the fixed name rule gives. */
export const REPATH_DONE_KEY = "vault_repath_v3";

/**
 * The local-day date a file named before the local-day fix should have, or undefined. Narrow:
 * only a prefix the app added (not a title's date), with no single linked date, that equals the
 * old UTC day of `addedAt` but not the local day. A user's own rename to another date is kept.
 */
const utcDayFix = (doc: DocumentRow, linked: readonly string[]): string | undefined => {
  const own = ownDatePrefix(doc);
  const local = addedDay(doc.addedAt);
  if (!own || own !== doc.addedAt.slice(0, 10) || own === local) return undefined;
  return documentDate(doc.addedAt, linked) === local ? local : undefined;
};

/**
 * The one-time re-path after the double-date fix (`vaultFileName`: a title that already starts
 * with a date, or with a year and a space, gets no prefix). Every live placed document whose
 * path differs from what the rule gives now moves (and a prefix the app gave by the old UTC day
 * takes the local day), each in its own journaled plan under the vault lock, with the collision
 * rule.
 * A crash or cancel leaves the moved files moved; the next run finishes the rest, then marks it
 * done. A path that would be over budget stays where it is. Returns how many files moved.
 */
export const repathDocuments = async (hooks: RunHooks = {}): Promise<number> => {
  const db = getDb();
  const flag = await db.select().from(meta).where(eq(meta.key, REPATH_DONE_KEY)).limit(1);
  if (flag[0]?.value === "done") return 0;
  const docs = (
    (await db
      .select()
      .from(document)
      .where(and(isNull(document.deletedAt), isNotNull(document.vaultPath)))) as DocumentRow[]
  ).toSorted(byAdded);
  const total = docs.length;
  let moved = 0;
  for (const [i, listed] of docs.entries()) {
    if (hooks.signal?.aborted) return moved;
    hooks.onProgress?.({ phase: "repathing", done: i, total });
    // Read again: an earlier move in this run can't change it, but the user can between runs.
    const [doc] = (await db
      .select()
      .from(document)
      .where(eq(document.id, listed.id))
      .limit(1)) as DocumentRow[];
    if (!doc || doc.deletedAt !== null || !doc.vaultPath) continue;
    const linked = await linkedDates([doc.id]);
    // The preview reuses this read for the document itself, so it is one query per document.
    const datesFor = (ids: readonly string[]) =>
      ids.length === 1 && ids[0] === doc.id ? Promise.resolve(linked) : linkedDates(ids);
    const fix = utcDayFix(doc, linked.get(doc.id) ?? []);
    const dates = fix ? [fix] : undefined;
    const want = await previewDocumentPath(doc, false, datesFor, dates);
    if (!want.fits || want.path === doc.vaultPath) continue;
    // placeOnly: the place changes, not the document, so no History row.
    const { documents } = await changeTree(
      { documents: [{ next: doc, placeOnly: true, dates, op: "update" }] },
      { strict: false, datesFor: linkedDates },
    );
    if (documents.get(doc.id)?.vaultPath !== doc.vaultPath) moved++;
  }
  await db
    .insert(meta)
    .values({ key: REPATH_DONE_KEY, value: "done" })
    .onConflictDoUpdate({ target: meta.key, set: { value: "done" } });
  hooks.onProgress?.({ phase: "done", done: total, total });
  return moved;
};
