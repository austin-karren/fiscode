import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Card } from "@fiscode/ui/components/card";
import { Button } from "@fiscode/ui/components/button";
import { buildBundle } from "@fiscode/db";
import { exportBundle } from "@fiscode/csv";
import { estimateYear, getYearConfig } from "@fiscode/tax";
import { cents, formatUSD, todayIso, yearOf } from "@fiscode/core";
import { FileSpreadsheet } from "lucide-react";

import { Page } from "../components/page";
import { buildAnnualizedInput, buildTaxInput, deriveYear } from "../lib/tax-input";
import { GLOSSARY } from "../lib/tax-glossary";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { InfoTooltip } from "../components/info-tooltip";

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
      } as const;
    }
    const profile = bundle.profile;
    const input =
      profile.quarterlyMethod === "annualized"
        ? buildAnnualizedInput(bundle, year)
        : buildTaxInput(bundle, year);
    const result = estimateYear({
      entity: "sole_prop",
      method: profile.quarterlyMethod === "annualized" ? "annualized" : "even",
      input,
    });
    const derived = deriveYear(bundle, year);
    const totalsByCategory: Record<string, number> = {};
    for (const e of bundle.expenses) {
      if (e.deletedAt !== null) continue;
      if (e.date.slice(0, 4) !== String(year)) continue;
      totalsByCategory[e.category] = (totalsByCategory[e.category] ?? 0) + e.amountCents;
    }
    return { bundle, profile, year, result, derived, totalsByCategory } as const;
  },
  component: YearEndPage,
});

function YearEndPage() {
  const data = useLoaderData({ from: "/year-end" });
  const { bundle, profile, year, result, derived, totalsByCategory } = data;

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

  const download = () => {
    const csv = exportBundle(bundle, { scope: "yearly", year });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fiscode-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasYearData =
    derived.gross1099 > 0 ||
    derived.directExpenses > 0 ||
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

  return (
    <Page
      title={`Year-end packet · ${year}`}
      description="Printable summary for the accountant. CSV download below contains the underlying data."
      actions={<Button onClick={download}>Download {year} CSV</Button>}
    >
      <Card className="p-4 print:border-0 print:shadow-none">
        <dl className="grid gap-2 @md:grid-cols-2">
          <Row label="Filing status" tooltip={GLOSSARY.filingStatus}>
            {profile.filingStatus.toUpperCase()}
          </Row>
          <Row label="State">{profile.state}</Row>
          <Row label="Entity">{derived.activeEntityType}</Row>
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

      <Card className="p-4 print:border-0 print:shadow-none">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Expense breakdown
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(totalsByCategory).map(([cat, total]) => (
              <tr key={cat} className="border-b border-border/40 last:border-b-0">
                <td className="py-1">{cat}</td>
                <td className="py-1 text-right tabular-nums">{formatUSD(cents(total))}</td>
              </tr>
            ))}
            {Object.keys(totalsByCategory).length === 0 ? (
              <tr>
                <td className="py-1 text-muted-foreground" colSpan={2}>
                  No expenses for {year}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 print:border-0 print:shadow-none">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Tax config used
        </h2>
        <p className="text-sm text-muted-foreground">
          Year config: {getYearConfig(year).year}. Mileage rate: $
          {getYearConfig(year).mileageRatePerMile.toFixed(3)}/mi. SS wage base:{" "}
          {formatUSD(cents(getYearConfig(year).ssWageBase))}.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tax figures change annually. Search for{" "}
          <code className="rounded bg-muted px-1">todo: verify</code> in the tax package source to
          see which figures need fresh confirmation.
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
    <div className="flex justify-between border-b border-border/40 py-1">
      <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
