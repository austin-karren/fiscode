import { Link, createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Card } from "@fiscode/ui/components/card";
import { Button } from "@fiscode/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { buildBundle, clientRepo, vehicleRepo } from "@fiscode/db";
import { exportBundle, exportFileName, type VehicleRow } from "@fiscode/csv";
import { estimateBundleYear, getYearConfig } from "@fiscode/tax";
import {
  cents,
  ENTITY_TYPE_LABELS,
  EXPENSE_CATEGORY_LABELS,
  FILING_STATUS_LABELS,
  formatUSD,
  INCOME_KIND_LABELS,
  labelFor,
  todayIso,
  yearOf,
} from "@fiscode/core";
import { CircleAlert, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { EntityUnsupportedAlert } from "../components/entity-unsupported-alert";
import { GLOSSARY } from "../lib/tax-glossary";
import { formatDate } from "../lib/format-date";
import { US_STATE_BY_CODE } from "../lib/us-states";
import { expenseTotalsByCategory, yearEndLists } from "../lib/year-end";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { InfoTooltip } from "../components/info-tooltip";
import { SectionTitle } from "../components/section-title";

export const Route = createFileRoute("/year-end")({
  // No beforeLoad redirect — route stays visitable without a profile so the
  // SetupRequiredEmpty fallback can render in-place. Without that guard the
  // user can land here from a deep-link or browser back-button and would
  // otherwise get bounced to /setup.
  loader: async () => {
    const bundle = await buildBundle();
    const year = yearOf(todayIso());
    if (!bundle.profile) {
      return {
        bundle,
        profile: undefined,
        year,
        result: undefined,
        derived: undefined,
        totalsByCategory: undefined,
        lists: undefined,
        names: undefined,
      } as const;
    }
    const profile = bundle.profile;
    const { result, derived } = estimateBundleYear(bundle, year);
    const totalsByCategory = expenseTotalsByCategory(bundle.expenses, year, profile.seStartDate);
    const lists = yearEndLists(bundle, year, derived.seStartDate);
    // The bundle leaves archived clients and vehicles out, but last year's
    // rows still name them.
    const names = {
      clients: await clientRepo.listIncludingDeleted(),
      vehicles: await vehicleRepo.listIncludingDeleted(),
    };
    return { bundle, profile, year, result, derived, totalsByCategory, lists, names } as const;
  },
  component: YearEndPage,
});

// The date on the packet is the day it is printed, which can be later than
// the day the page was opened. `beforeprint` also fires for the browser's own
// print command, and the update has to land before the print snapshot.
function usePrintDate() {
  const [printedOn, setPrintedOn] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => flushSync(() => setPrintedOn(new Date()));
    window.addEventListener("beforeprint", refresh);
    return () => window.removeEventListener("beforeprint", refresh);
  }, []);
  return printedOn;
}

function YearEndPage() {
  const data = useLoaderData({ from: "/year-end" });
  const { profile, year, result, derived, totalsByCategory, lists, names } = data;
  const printedOn = usePrintDate();

  // Profile missing → route still renders, but with SetupRequiredEmpty in
  // place of the packet. Avoids the dead-end of bouncing the user back to
  // /setup when they deep-link or hit back/forward.
  if (!profile || !result || !derived || !totalsByCategory) {
    return (
      <Page title={`Year-end packet · ${year}`} description="Printable summary for the accountant.">
        <SetupRequiredEmpty />
      </Page>
    );
  }

  const download = async () => {
    const options = { scope: "yearly", year } as const;
    let csv: string;
    try {
      // The packet above shows live rows; the file carries deleted ones too.
      csv = exportBundle(await buildBundle({ includeDeleted: true }), options);
    } catch (err) {
      console.error(err);
      toast.error("Export failed.", {
        description: err instanceof Error ? err.message : String(err),
        duration: Infinity,
        closeButton: true,
      });
      return;
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(options, todayIso());
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasYearData =
    derived.gross1099 > 0 ||
    derived.directExpenses > 0 ||
    derived.selfEmployedHealthInsurance > 0 ||
    derived.mileageDeduction > 0 ||
    derived.homeOfficeDeduction > 0;

  if (!hasYearData) {
    return (
      <Page title={`Year-end packet · ${year}`} description="Printable summary for the accountant.">
        <NoDataEmpty
          icon={FileSpreadsheet}
          title={`Nothing to report for ${year} yet`}
          description="Add income or expenses on the dashboard, then come back here for a printable packet."
        />
      </Page>
    );
  }

  const excl = derived.excludedBeforeSeStart;
  const exclTotal = excl.income + excl.expense + excl.mileage;

  return (
    <Page
      title={`Year-end packet · ${year}`}
      description="Printable summary for the accountant. CSV download below contains the underlying data."
      actions={
        <>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          <Button onClick={download}>Download {year} CSV</Button>
        </>
      }
      printHeader={
        <>
          <h1 className="text-2xl font-semibold tracking-tight">fiscode year-end summary</h1>
          <p className="mt-1 text-sm">Tax year {year}</p>
          <p className="text-sm">
            Printed {printedOn.toLocaleDateString("en-US", { dateStyle: "long" })}
          </p>
        </>
      }
    >
      <EntityUnsupportedAlert derived={derived} />
      {exclTotal > 0 ? (
        <Alert variant="warning">
          <CircleAlert />
          <AlertTitle>Some rows are dated before your SE start date</AlertTitle>
          <AlertDescription>
            {excl.income} income, {excl.expense} expense, {excl.mileage} mileage rows dated before{" "}
            {formatDate(derived.seStartDate)} are not counted. Review them on their respective
            pages.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="p-4 print:break-inside-avoid print:overflow-visible print:p-0 print:ring-0">
        <dl className="grid gap-2 gap-x-12 @md:grid-cols-2">
          <Row label="Filing status" tooltip={GLOSSARY.filingStatus}>
            {labelFor(FILING_STATUS_LABELS, profile.filingStatus)}
          </Row>
          <Row label="State">{US_STATE_BY_CODE[profile.state] ?? profile.state}</Row>
          <Row label="Entity">{labelFor(ENTITY_TYPE_LABELS, derived.entityType)}</Row>
          <Row label="1099 income" tooltip={GLOSSARY.income1099}>
            {formatUSD(derived.gross1099)}
          </Row>
          <Row label="Direct expenses">{formatUSD(derived.directExpenses)}</Row>
          <Row label="Mileage deduction" tooltip={GLOSSARY.standardMileage}>
            {formatUSD(derived.mileageDeduction)}
          </Row>
          <Row label="Home office deduction">{formatUSD(derived.homeOfficeDeduction)}</Row>
          <Row label="Net profit" tooltip={GLOSSARY.netProfit}>
            <b>{formatUSD(result.estimate.netProfit)}</b>
          </Row>
          {derived.selfEmployedHealthInsurance > 0 ? (
            // The allowed deduction, after its limit. It lowers income tax,
            // not net profit or SE tax.
            <Row
              label={`${labelFor(EXPENSE_CATEGORY_LABELS, "health_insurance")}, deductible (Schedule 1 line 17)`}
            >
              {formatUSD(result.estimate.selfEmployedHealthInsurance)}
            </Row>
          ) : null}
          <Row label="Self-employment tax" tooltip={GLOSSARY.seTax}>
            {formatUSD(result.estimate.se.totalSeTax)}
          </Row>
          <Row label="QBI deduction" tooltip={GLOSSARY.qbi}>
            {formatUSD(result.estimate.federal.qbiDeduction)}
          </Row>
          <Row label="Federal income tax" tooltip={GLOSSARY.federalIncomeTax}>
            {formatUSD(result.estimate.federal.federalIncomeTax)}
          </Row>
          <Row label="State income tax" tooltip={GLOSSARY.stateIncomeTax}>
            {formatUSD(result.estimate.state.stateIncomeTax)}
          </Row>
          <Row label="Total liability" tooltip={GLOSSARY.totalLiability}>
            <b>{formatUSD(result.estimate.totalLiability)}</b>
          </Row>
          <Row label="Spouse withholding">{formatUSD(result.estimate.spouseWithholding)}</Row>
          <Row label="Remaining owed" tooltip={GLOSSARY.remainingOwed}>
            {formatUSD(result.estimate.remainingOwed)}
          </Row>
        </dl>
      </Card>

      <YearEndLists lists={lists!} names={names!} year={year} derived={derived} />

      <Card className="p-4 print:break-inside-avoid print:overflow-visible print:p-0 print:ring-0">
        <SectionTitle className="mb-3">Expense breakdown</SectionTitle>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(totalsByCategory).map(([cat, total]) => (
              <tr
                key={cat}
                className="break-inside-avoid border-b border-border/40 last:border-b-0"
              >
                <td className="py-1">{labelFor(EXPENSE_CATEGORY_LABELS, cat)}</td>
                <td className="py-1 text-right tabular-nums">{formatUSD(cents(total))}</td>
              </tr>
            ))}
            {derived.startupCosts.total > 0 ? (
              <tr className="break-inside-avoid border-b border-border/40 last:border-b-0">
                <td className="py-1">
                  Startup costs (Section 195): deducted this year, of{" "}
                  {formatUSD(derived.startupCosts.total)} paid before the business began. The rest
                  is amortized over 180 months.
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatUSD(derived.startupCosts.deductedThisYear)}
                </td>
              </tr>
            ) : null}
            {derived.selfEmployedHealthInsurance > 0 ? (
              // Paid premiums: an adjustment on Schedule 1, not a Schedule C
              // expense, so they sit apart from the categories above.
              <tr className="break-inside-avoid border-t-2 border-border">
                <td className="py-1">
                  {labelFor(EXPENSE_CATEGORY_LABELS, "health_insurance")}, premiums paid: not
                  Schedule C; an adjustment on Schedule 1 line 17.
                  {result.estimate.selfEmployedHealthInsurance <
                  derived.selfEmployedHealthInsurance ? (
                    <span className="block text-xs text-muted-foreground">
                      The deduction is limited to net profit minus half the SE tax:{" "}
                      {formatUSD(result.estimate.selfEmployedHealthInsurance)}.
                    </span>
                  ) : null}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatUSD(derived.selfEmployedHealthInsurance)}
                </td>
              </tr>
            ) : null}
            {Object.keys(totalsByCategory).length === 0 &&
            derived.startupCosts.total === 0 &&
            derived.selfEmployedHealthInsurance === 0 ? (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={2}>
                  No expenses for {year}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 print:break-inside-avoid print:overflow-visible print:p-0 print:ring-0">
        <SectionTitle className="mb-3">Tax config used</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Year config: {getYearConfig(year).year}. Mileage rate:{" "}
          {getYearConfig(year)
            .mileageRates.map((r) => `$${r.ratePerMile.toFixed(3)}/mi from ${formatDate(r.from)}`)
            .join(", ")}
          . SS wage base: {formatUSD(cents(getYearConfig(year).ssWageBase))}.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tax figures change every year. Confirm them against the IRS and SSA before filing. The
          figures fiscode uses are on the{" "}
          <Link to="/tax-data" className="underline underline-offset-2">
            Tax data
          </Link>{" "}
          screen.
        </p>
      </Card>
    </Page>
  );
}

function Row({
  label,
  children,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="flex break-inside-avoid justify-between border-b border-border/40 py-1">
      <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

// A list card for the packet. Long lists may break across printed pages, so
// only each row is kept whole.
function ListCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 print:overflow-visible print:p-0 print:ring-0">
      {/* Printed, a heading stays on the page with its table. */}
      <SectionTitle className="mb-3 print:break-after-avoid">{title}</SectionTitle>
      <div className="overflow-x-auto print:overflow-visible">{children}</div>
    </Card>
  );
}

const ROW = "break-inside-avoid border-b border-border/40";
const TOTAL_ROW = "break-inside-avoid font-medium";

function YearEndLists({
  lists,
  names,
  year,
  derived,
}: {
  lists: ReturnType<typeof yearEndLists>;
  /** Every client and vehicle, archived ones included. */
  names: { clients: { id: string; name: string }[]; vehicles: VehicleRow[] };
  year: number;
  derived: { gross1099: number; mileageDeduction: number };
}) {
  const clientName = (id: string | null) =>
    id === null ? "No client" : (names.clients.find((c) => c.id === id)?.name ?? "Unknown client");
  const vehicleName = (id: string | null) => {
    const v = names.vehicles.find((x) => x.id === id);
    return v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "—";
  };
  const totalMiles = lists.mileage.reduce((sum, t) => sum + t.businessMiles, 0);
  return (
    <>
      <ListCard title="1099 income by client">
        <table className="w-full text-sm">
          <tbody>
            {lists.clientTotals.map((t) => (
              <tr key={t.clientId ?? "none"} className={ROW}>
                <td className="py-1">{clientName(t.clientId)}</td>
                <td className="py-1 text-right tabular-nums">{formatUSD(cents(t.amountCents))}</td>
              </tr>
            ))}
            {lists.clientTotals.length === 0 ? (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={2}>
                  No 1099 income for {year}.
                </td>
              </tr>
            ) : (
              <tr className={TOTAL_ROW}>
                <td className="py-1">Total 1099 income</td>
                <td className="py-1 text-right tabular-nums">
                  {formatUSD(cents(derived.gross1099))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ListCard>

      <ListCard title="1099 income">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className={ROW}>
              <th className="py-1 pe-3 font-medium">Date</th>
              <th className="py-1 pe-3 font-medium">Client</th>
              <th className="py-1 pe-3 font-medium">Kind</th>
              <th className="py-1 pe-3 font-medium">Description</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lists.income.map((i) => (
              <tr key={i.id} className={ROW}>
                <td className="py-1 pe-3 whitespace-nowrap">{formatDate(i.date)}</td>
                <td className="py-1 pe-3">{clientName(i.clientId)}</td>
                <td className="py-1 pe-3">{labelFor(INCOME_KIND_LABELS, i.kind)}</td>
                <td className="py-1 pe-3">{i.description ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{formatUSD(cents(i.amountCents))}</td>
              </tr>
            ))}
            {lists.income.length === 0 ? (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={5}>
                  No 1099 income for {year}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </ListCard>

      <ListCard title="Mileage log">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className={ROW}>
              <th className="py-1 pe-3 font-medium">Date</th>
              <th className="py-1 pe-3 font-medium">Vehicle</th>
              <th className="py-1 pe-3 font-medium">Purpose</th>
              <th className="py-1 pe-3 text-right font-medium">Miles</th>
              <th className="py-1 text-right font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {lists.mileage.map((t) => (
              <tr key={t.id} className={ROW}>
                <td className="py-1 pe-3 whitespace-nowrap">{formatDate(t.date)}</td>
                <td className="py-1 pe-3">{vehicleName(t.vehicleId)}</td>
                <td className="py-1 pe-3">{t.purpose ?? "—"}</td>
                <td className="py-1 pe-3 text-right tabular-nums">{t.businessMiles}</td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap">
                  ${t.ratePerMile.toFixed(3)}/mi
                </td>
              </tr>
            ))}
            {lists.mileage.length === 0 ? (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={5}>
                  No business trips for {year}.
                </td>
              </tr>
            ) : (
              <tr className={TOTAL_ROW}>
                <td className="py-1 pe-3" colSpan={3}>
                  Total ({formatUSD(cents(derived.mileageDeduction))} deduction)
                </td>
                <td className="py-1 pe-3 text-right tabular-nums">{totalMiles}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </ListCard>
    </>
  );
}
