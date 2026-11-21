import { useRef } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { cents, formatUSD, todayIso, yearOf } from "@fiscode/core";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { SectionTitle } from "../components/section-title";
import { EditW2JobDialog } from "../components/edit-w2-job-dialog";
import { W2Fields, w2Defaults, w2InsertFrom, w2Label, useW2Form } from "../components/w2-job-form";
import { w2JobRepo } from "../lib/w2-payments-stub";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { formatDate } from "../lib/format-date";

export const Route = createFileRoute("/w2-jobs")({
  loader: async () => ({ jobs: await w2JobRepo.list(), year: yearOf(todayIso()) }),
  component: W2JobsPage,
});

function W2JobsPage() {
  const { jobs, year } = useLoaderData({ from: "/w2-jobs" });
  const router = useRouter();
  const firstValue = useRef<HTMLInputElement>(null);

  const form = useW2Form(w2Defaults(year), async (value, reset) => {
    await w2JobRepo.create(w2InsertFrom(value));
    toast.success("W-2 added.");
    reset();
    await router.invalidate();
    firstValue.current?.focus();
  });

  const remove = async (row: (typeof jobs)[number], from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    await softDeleteWithUndo({
      repo: w2JobRepo,
      row,
      message: "W-2 deleted.",
      undoneMessage: "W-2 restored.",
      onChange: () => router.invalidate(),
    });
    await router.invalidate();
    refocus();
  };

  // Either end may be blank: say what is known, never "?".
  const dates = (j: (typeof jobs)[number]) =>
    j.startDate && j.endDate
      ? `${formatDate(j.startDate)} – ${formatDate(j.endDate)}`
      : j.startDate
        ? `From ${formatDate(j.startDate)}`
        : j.endDate
          ? `Until ${formatDate(j.endDate)}`
          : "—";

  return (
    <Page
      title="W-2 jobs"
      description="Your own W-2s from jobs this year or last. Your spouse's W-2 income stays on Profile."
    >
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Add W-2</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-4">
            <W2Fields form={form} year={year} firstValue={firstValue} />
          </CardContent>
          <CardFooter className="justify-end">
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      {jobs.length === 0 ? (
        <NoDataEmpty
          icon={Building2}
          title="No W-2 jobs yet"
          description="Add a W-2 if you had a job this year: its wages and withholding change your estimate."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Employer</DataTable.HeaderCell>
              <DataTable.HeaderCell>Year</DataTable.HeaderCell>
              <DataTable.HeaderCell>Worked</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Wages</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Federal withheld</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Utah withheld</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {jobs
              .slice()
              .sort((a, b) => b.taxYear - a.taxYear || a.employer.localeCompare(b.employer))
              .map((j) => (
                <DataTable.Row key={j.id}>
                  <DataTable.Cell label="Employer">{j.employer}</DataTable.Cell>
                  <DataTable.Cell label="Year">{j.taxYear}</DataTable.Cell>
                  <DataTable.Cell label="Worked">{dates(j)}</DataTable.Cell>
                  <DataTable.Cell label="Wages" align="right">
                    {formatUSD(cents(j.wagesCents))}
                  </DataTable.Cell>
                  <DataTable.Cell label="Federal withheld" align="right">
                    {formatUSD(cents(j.federalWithholdingCents))}
                  </DataTable.Cell>
                  <DataTable.Cell label="Utah withheld" align="right">
                    {formatUSD(cents(j.stateWithholdingCents))}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditW2JobDialog job={j} year={year} onSaved={() => router.invalidate()} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => void remove(j, e.currentTarget)}
                      >
                        Delete <span className="sr-only">{w2Label(j)}</span>
                      </Button>
                    </div>
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
