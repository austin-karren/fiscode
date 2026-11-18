// Name of the client or vehicle a row points at. An archived parent keeps
// its name on old rows, with a muted "archived" note, so archiving never
// makes history unreadable. `parent` is undefined when the row has no link
// or the link points at nothing.
export function ParentName({
  parent,
}: {
  parent: { name: string; deletedAt?: string | null } | undefined;
}) {
  if (!parent) return <>—</>;
  return (
    <>
      {parent.name}
      {parent.deletedAt ? <ArchivedNote /> : null}
    </>
  );
}

// Muted "archived" after a name. The leading space is real text, so the
// name and the note stay two words when read aloud or copied.
export function ArchivedNote() {
  return <span className="text-muted-foreground"> · archived</span>;
}

// Parents a row's picker may offer: every live one, plus the archived one the
// row already points at, labelled as archived, so opening and saving the row
// keeps its link.
export function pickableParents<T extends { id: string; deletedAt?: string | null }>(
  all: T[],
  currentId: string | null | undefined,
): T[] {
  return all.filter((p) => !p.deletedAt || p.id === currentId);
}

export const archivedSuffix = (parent: { deletedAt?: string | null }): string =>
  parent.deletedAt ? " (archived)" : "";
