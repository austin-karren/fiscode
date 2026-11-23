// Why a screen's writes are off (the vault migration, ADR 0001 § 10). Controls stay visible but
// disabled, and this one line says why, so nobody presses a dead button wondering.
export function ReadOnlyNote({ reason }: { reason: string | undefined }) {
  if (!reason) return null;
  return <p className="text-sm text-muted-foreground">{reason}</p>;
}
