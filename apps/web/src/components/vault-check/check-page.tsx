import { useRef, useState, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { Button, buttonVariants } from "@fiscode/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { CircleCheck } from "lucide-react";

import {
  acknowledgeChanged,
  adoptMoved,
  applyRecordDates,
  getVaultStore,
  importNewFiles,
  moveBack,
  putBack,
  scanReviewCount,
  scanVault,
  type ScanProgress,
  type ScanReport,
  type VaultMigrationReport,
} from "@fiscode/db";
import { errorLine, formatBytes } from "../../lib/documents-view";
import { formatDateTime } from "../../lib/format-date";
import {
  adoptCreatesLine,
  adoptFallbackLine,
  adoptResultLines,
  baseName,
  count,
  scanProgressLine,
  skippedLine,
} from "../../lib/vault-check-view";
import { useVaultReadOnly } from "../../lib/vault-migration";
import { BACKUP_CARD_ID } from "../backup-card";
import { ReadOnlyNote } from "../read-only-note";
import { SectionTitle } from "../section-title";

type Check =
  | { at: "idle" }
  | { at: "running"; progress?: ScanProgress }
  | { at: "failed"; line: string };

/**
 * Check folder (ADR 0001 § 6, § 11.4): compares the vault folder with fiscode's records and lists
 * what differs, one section per kind, each with its own actions. Nothing is deleted from here.
 */
export function CheckPage({
  report,
  migration,
}: {
  report: ScanReport | undefined;
  migration: VaultMigrationReport | undefined;
}) {
  const router = useRouter();
  const readOnly = useVaultReadOnly();
  const [check, setCheck] = useState<Check>({ at: "idle" });
  // One action at a time, and one error line: the last thing tried. Check now's shows under it,
  // an action's in its section; anything tried next clears it (REVIEW #112 r1 F3).
  const [acting, setActing] = useState<string>();
  const [failed, setFailed] = useState<{ section: string; line: string }>();
  // What the last adopt did beyond moving files (folders made, Unfiled and why), shown under
  // Check now: the moved items are gone from the list by then. Cleared by the next thing tried.
  const [adopted, setAdopted] = useState<string[]>([]);
  const busy = check.at === "running" || acting !== undefined;
  const off = busy || !!readOnly;

  const checkNow = async () => {
    setCheck({ at: "running" });
    setFailed(undefined);
    setAdopted([]);
    try {
      const result = await scanVault({
        trigger: "check",
        onProgress: (progress) => setCheck({ at: "running", progress }),
      });
      if (result.status === "skipped") {
        setCheck({ at: "idle" });
        setFailed({ section: "check", line: skippedLine(result) });
        return;
      }
      setCheck({ at: "idle" });
      await router.invalidate();
    } catch (err) {
      setCheck({ at: "idle" });
      setFailed({ section: "check", line: errorLine(err) });
    }
  };

  const act = async (section: string, run: () => Promise<unknown>) => {
    setActing(section);
    setFailed(undefined);
    setAdopted([]);
    try {
      await run();
      await router.invalidate();
    } catch (err) {
      setFailed({ section, line: errorLine(err) });
    } finally {
      setActing(undefined);
    }
  };
  const problem = (section: string) =>
    failed?.section === section ? (
      <p role="alert" className="text-sm text-destructive">
        {failed.line}
      </p>
    ) : null;

  const adopt = (items: ScanReport["moved"]) =>
    act("moved", async () => {
      const result = await adoptMoved(items);
      setAdopted(adoptResultLines(result, new Map(items.map((m) => [m.documentId, m.name]))));
    });

  const findings = report ? scanReviewCount(report) : 0;
  const restorable = report?.missing.filter((m) => m.restorable) ?? [];
  const notHere = report?.missing.filter((m) => !m.restorable) ?? [];
  // A swap is adopted as a whole: adopting one alone renames its partner's file (REVIEW #112 r1
  // F1), and Move back refuses while the other file is there.
  const swapped = report?.moved.filter((m) => m.swapped) ?? [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Compares the files in your vault folder with fiscode's records, for anything moved,
            edited or added outside the app. Nothing is deleted from here.
          </p>
          <ReadOnlyNote reason={readOnly} />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={off} onClick={() => void checkNow()}>
                {check.at === "running" ? "Checking…" : "Check now"}
              </Button>
              {report ? (
                <span className="text-sm text-muted-foreground">
                  Last checked {formatDateTime(report.scannedAt)}
                </span>
              ) : null}
            </div>
            {/* Always mounted, so a screen reader hears the lines when they arrive; the list
                inside keeps its list role (REVIEW #118 r1). It shares
                the row's grid cell, so empty it adds no gap (r2). */}
            <div role="status">
              {adopted.length > 0 ? (
                <ul className="mt-3 grid gap-0.5 text-sm">
                  {adopted.map((line, i) => (
                    // Two files of the same name can go to Unfiled for the same reason.
                    <li key={i} className="break-all">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
          {check.at === "running" ? (
            <p role="status" className="text-sm">
              {scanProgressLine(check.progress)}…
            </p>
          ) : null}
          {problem("check")}
        </CardContent>
      </Card>

      {!report ? (
        <p className="text-sm text-muted-foreground">Not checked yet. Check now to compare.</p>
      ) : findings === 0 ? (
        <Alert>
          <CircleCheck />
          <AlertTitle>Everything matches</AlertTitle>
          <AlertDescription>
            {count(report.ok, "file")} in your folder match fiscode's records.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Section title="Moved" items={report.moved.length}>
            <p className="text-sm text-muted-foreground">
              Found at another place in your folder. Adopt keeps the new place, and makes any folder
              you made there; Move back returns the file to where fiscode had it.
            </p>
            {swapped.length > 0 ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  {count(swapped.length, "file")} swapped places with each other. Adopt them
                  together, so no file is renamed to make room.
                </p>
                <div>
                  <Button size="sm" disabled={off} onClick={() => void adopt(swapped)}>
                    Adopt the swap
                  </Button>
                </div>
              </div>
            ) : null}
            {report.moved.length > 1 ? (
              <div>
                <Button
                  size="sm"
                  variant={swapped.length > 0 ? "outline" : "default"}
                  disabled={off}
                  onClick={() => void adopt(report.moved)}
                >
                  Adopt all
                </Button>
              </div>
            ) : null}
            {problem("moved")}
            <Items>
              {report.moved.map((m) => (
                <Item key={m.documentId} title={m.name}>
                  <Path label="Was">{m.path}</Path>
                  <Path label="Now">{m.foundAt}</Path>
                  {m.adoptFallback ? (
                    <Note>{adoptFallbackLine(m.adoptFallback)}</Note>
                  ) : m.adoptNewFolders?.length ? (
                    <Note>{adoptCreatesLine(m.adoptNewFolders)}</Note>
                  ) : null}
                  {m.swapped ? (
                    <Note>Swapped with another file: use Adopt the swap above.</Note>
                  ) : (
                    <Actions>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={off}
                        onClick={() => void adopt([m])}
                      >
                        Adopt <span className="sr-only">{m.name}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={off}
                        onClick={() => void act("moved", () => moveBack([m]))}
                      >
                        Move back <span className="sr-only">{m.name}</span>
                      </Button>
                    </Actions>
                  )}
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Edited outside fiscode" items={report.changed.length}>
            <p className="text-sm text-muted-foreground">
              Already saved as a new version, so History has the change. Each stays here until you
              acknowledge it.
            </p>
            {report.changed.length > 1 ? (
              <div>
                <Button
                  size="sm"
                  disabled={off}
                  onClick={() => void act("changed", () => acknowledgeChanged("all"))}
                >
                  Acknowledge all
                </Button>
              </div>
            ) : null}
            {problem("changed")}
            <Items>
              {report.changed.map((c) => (
                <Item key={c.documentId} title={c.name}>
                  <Path>{c.path}</Path>
                  <Note>
                    {c.oldBytesKept
                      ? "The earlier version is kept."
                      : "The earlier version wasn't on this device, so it isn't kept."}
                  </Note>
                  <Actions>
                    <DocLink id={c.documentId} name={c.name} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={off}
                      onClick={() => void act("changed", () => acknowledgeChanged([c]))}
                    >
                      Acknowledge <span className="sr-only">{c.name}</span>
                    </Button>
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="New in folder" items={report.unknown.length}>
            <p className="text-sm text-muted-foreground">
              Files fiscode has no record of. Import adds each as a document where it is.
            </p>
            {report.unknown.length > 1 ? (
              <div>
                <Button
                  size="sm"
                  disabled={off}
                  onClick={() => void act("unknown", () => importNewFiles(report.unknown))}
                >
                  Import all
                </Button>
              </div>
            ) : null}
            {problem("unknown")}
            <Items>
              {report.unknown.map((u) => (
                <Item key={u.path} title={u.name}>
                  <Path>{u.path}</Path>
                  <Note>{formatBytes(u.sizeBytes)}</Note>
                  <Actions>
                    <OpenPath path={u.path} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={off}
                      onClick={() => void act("unknown", () => importNewFiles([u]))}
                    >
                      Import <span className="sr-only">{u.name}</span>
                    </Button>
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Date no longer matches" items={report.redated.length}>
            <p className="text-sm text-muted-foreground">
              The date at the start of the file name differs from its record's date. Apply renames
              the file to the record's date.
            </p>
            {report.redated.length > 1 ? (
              <div>
                <Button
                  size="sm"
                  disabled={off}
                  onClick={() => void act("redated", () => applyRecordDates(report.redated))}
                >
                  Apply all
                </Button>
              </div>
            ) : null}
            {problem("redated")}
            <Items>
              {report.redated.map((r) => (
                <Item key={r.documentId} title={r.name}>
                  <Path>{r.path}</Path>
                  <Note>
                    File date {r.fileDate}, record date {r.expectedDate}.
                  </Note>
                  <Actions>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={off}
                      onClick={() => void act("redated", () => applyRecordDates([r]))}
                    >
                      Apply record date <span className="sr-only">{r.name}</span>
                    </Button>
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Restorable from this device" items={restorable.length}>
            <p className="text-sm text-muted-foreground">
              Gone from your folder, but this device still has the file. Put it back writes it where
              fiscode had it.
            </p>
            {restorable.length > 1 ? (
              <div>
                <Button
                  size="sm"
                  disabled={off}
                  onClick={() => void act("restorable", () => putBack(restorable))}
                >
                  Put all back
                </Button>
              </div>
            ) : null}
            {problem("restorable")}
            <Items>
              {restorable.map((m) => (
                <Item key={m.documentId} title={m.name}>
                  {m.path ? <Path>{m.path}</Path> : null}
                  <Actions>
                    <DocLink id={m.documentId} name={m.name} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={off}
                      onClick={() => void act("restorable", () => putBack([m]))}
                    >
                      Put it back <span className="sr-only">{m.name}</span>
                    </Button>
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Not on this device" items={notHere.length}>
            <Items>
              {notHere.map((m) => (
                <Item key={m.documentId} title={m.name}>
                  {m.path ? <Path>{m.path}</Path> : null}
                  <p className="text-sm">
                    File not on this device —{" "}
                    <Link to="/" hash={BACKUP_CARD_ID} className="underline underline-offset-4">
                      restore a backup
                    </Link>
                  </p>
                  <Actions>
                    <DocLink id={m.documentId} name={m.name} />
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Sync conflicts" items={report.conflicts.length}>
            <p className="text-sm text-muted-foreground">
              A sync app kept two copies. Open both, keep the one you want under the original name,
              delete the other in your folder, then Check now.
            </p>
            <Items>
              {report.conflicts.map((c) => (
                <Item key={c.path} title={baseName(c.originalPath)}>
                  <Path label="Original">{c.originalPath}</Path>
                  <Path label="Copy">{c.path}</Path>
                  <Actions>
                    <OpenPath path={c.originalPath} label="Open original" />
                    <OpenPath path={c.path} label="Open copy" />
                  </Actions>
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Found in more than one place" items={report.ambiguous.length}>
            <p className="text-sm text-muted-foreground">
              The same file is at several places, so fiscode can't tell which is the move. Keep one
              where you want it, delete the others in your folder, then Check now.
            </p>
            <Items>
              {report.ambiguous.map((a) => (
                <Item key={a.documentId} title={a.name}>
                  <Path label="Was">{a.path}</Path>
                  {a.foundAt.map((p) => (
                    <div key={p} className="flex flex-wrap items-center gap-2">
                      <Path label="Found">{p}</Path>
                      <OpenPath path={p} />
                    </div>
                  ))}
                </Item>
              ))}
            </Items>
          </Section>

          <Section title="Too large" items={report.tooLarge.length}>
            <p className="text-sm text-muted-foreground">
              Edited outside fiscode to over 25 MB, so the edit isn't recorded. The document keeps
              its earlier version.
            </p>
            <Items>
              {report.tooLarge.map((t) => (
                <Item key={t.documentId} title={t.name}>
                  <Path>{t.path}</Path>
                  <Note>{formatBytes(t.sizeBytes)}</Note>
                </Item>
              ))}
            </Items>
          </Section>
        </>
      )}

      {migration && migrationDidSomething(migration) ? (
        <MigrationReport report={migration} />
      ) : null}
    </div>
  );
}

/** A vault that never needed moving has nothing to report (REVIEW #112 r1 F2). */
export const migrationDidSomething = (r: VaultMigrationReport): boolean =>
  r.placed > 0 ||
  r.oldBytesKept > 0 ||
  r.foldersShortened.length > 0 ||
  r.titlesShortened.length > 0 ||
  r.overBudget.length > 0 ||
  r.missing.length > 0;

function MigrationReport({ report }: { report: VaultMigrationReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionTitle>Moving into the vault</SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p>
          Finished {formatDateTime(report.finishedAt)}: {count(report.placed, "file")} placed,{" "}
          {count(report.oldBytesKept, "earlier version")} kept.
        </p>
        {report.foldersShortened.length > 0 ? (
          <Shortened
            title={`${count(report.foldersShortened.length, "folder name")} shortened to fit`}
          >
            {report.foldersShortened.map((f) => (
              <li key={f.folderId} className="break-all">
                {f.from} → {f.to}
              </li>
            ))}
          </Shortened>
        ) : null}
        {report.titlesShortened.length > 0 ? (
          <Shortened
            title={`${count(report.titlesShortened.length, "file name")} shortened to fit`}
          >
            {report.titlesShortened.map((t) => (
              <li key={t.documentId} className="break-all">
                {t.name} → {t.path}
              </li>
            ))}
          </Shortened>
        ) : null}
        {report.overBudget.length > 0 ? (
          <Shortened title={`${count(report.overBudget.length, "path")} still too long`}>
            {report.overBudget.map((o) => (
              <li key={o.documentId} className="break-all">
                {o.path} ({count(o.overBy, "character")} over)
              </li>
            ))}
          </Shortened>
        ) : null}
        {report.missing.length > 0 ? (
          <p>
            {count(report.missing.filter((m) => m.reason === "missing").length, "file")} not on this
            device, {count(report.missing.filter((m) => m.reason === "damaged").length, "file")}{" "}
            damaged.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Shortened({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="font-medium">{title}</p>
      <ul className="grid list-disc gap-0.5 pl-4 text-muted-foreground">{children}</ul>
    </div>
  );
}

function Section({
  title,
  items,
  children,
}: {
  title: string;
  items: number;
  children: ReactNode;
}) {
  if (items === 0) return null;
  return (
    <Card role="region" aria-label={`${title}: ${items}`}>
      <CardHeader>
        <CardTitle>
          <SectionTitle>
            {title}
            <span className="tabular-nums">({items})</span>
          </SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">{children}</CardContent>
    </Card>
  );
}

const Items = ({ children }: { children: ReactNode }) => (
  <ul className="grid divide-y divide-border rounded-md border border-border">{children}</ul>
);

const Item = ({ title, children }: { title: string; children: ReactNode }) => (
  <li className="grid min-w-0 gap-1 p-3">
    <p className="font-medium break-all">{title}</p>
    {children}
  </li>
);

const Path = ({ label, children }: { label?: string; children: string }) => (
  <p className="min-w-0 font-mono text-xs break-all text-muted-foreground">
    {label ? <span className="font-sans">{label}: </span> : null}
    {children}
  </p>
);

const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

const Actions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap gap-2 pt-1">{children}</div>
);

function DocLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to="/documents"
      search={{ doc: id }}
      className={buttonVariants({ size: "sm", variant: "ghost" })}
    >
      Open <span className="sr-only">{name}</span>
    </Link>
  );
}

/** Opens a file in the vault folder by its path, in a new tab, from this device's copy. */
function OpenPath({ path, label = "Open" }: { path: string; label?: string }) {
  const [problem, setProblem] = useState<string>();
  const opened = useRef<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          setProblem(undefined);
          try {
            const blob = await getVaultStore().read(path);
            if (!blob) throw new Error("That file isn't in your folder any more. Check now.");
            if (opened.current) URL.revokeObjectURL(opened.current);
            opened.current = URL.createObjectURL(blob);
            window.open(opened.current, "_blank", "noopener");
          } catch (err) {
            setProblem(errorLine(err));
          }
        }}
      >
        {label} <span className="sr-only">{baseName(path)}</span>
      </Button>
      {problem ? (
        <span role="alert" className="text-sm text-destructive">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
