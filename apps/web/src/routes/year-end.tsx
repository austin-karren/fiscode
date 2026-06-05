import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Card } from "@fiscode/ui/components/card";
import { Button } from "@fiscode/ui/components/button";
import { buildBundle } from "@fiscode/db";
import { exportBundle } from "@fiscode/csv";
import { estimateYear, getYearConfig } from "@fiscode/tax";
import { cents, formatUSD, todayIso, yearOf } from "@fiscode/core";

import { Page } from "../components/page";
import { buildAnnualizedInput, buildTaxInput, deriveYear } from "../lib/tax-input";

export const Route = createFileRoute("/year-end")({
  loader: async () => {
    const bundle = await buildBundle();
    const profile = bundle.profile!;
    const year = yearOf(todayIso());
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
    return { bundle, profile, year, result, derived, totalsByCategory };
  },
  component: YearEndPage,
});

function YearEndPage() {
  const { bundle, profile, year, result, derived, totalsByCategory } = useLoaderData({
    from: "/year-end",
  });

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

  return (
    <Page
      title={`Year-end packet · ${year}`}
      description="Printable summary for the accountant. CSV download below contains the underlying data."
      actions={<Button onClick={download}>Download {year} CSV</Button>}
    >
      <Card className="p-4 print:border-0 print:shadow-none">
        <dl className="grid gap-2 @md:grid-cols-2">
          <Row label="Filing status">{profile.filingStatus.toUpperCase()}</Row>
          <Row label="State">{profile.state}</Row>
          <Row label="Entity">{derived.activeEntityType}</Row>
          <Row label="1099 income">{formatUSD(derived.gross1099)}</Row>
          <Row label="Direct expenses">{formatUSD(derived.directExpenses)}</Row>
          <Row label="Mileage deduction">{formatUSD(derived.mileageDeduction)}</Row>
          <Row label="Home office deduction">{formatUSD(derived.homeOfficeDeduction)}</Row>
          <Row label="Net profit">
            <b>{formatUSD(result.estimate.netProfit)}</b>
          </Row>
          <Row label="Self-employment tax">{formatUSD(result.estimate.se.totalSeTax)}</Row>
          <Row label="QBI deduction">{formatUSD(result.estimate.federal.qbiDeduction)}</Row>
          <Row label="Federal income tax">
            {formatUSD(result.estimate.federal.federalIncomeTax)}
          </Row>
          <Row label="State income tax">{formatUSD(result.estimate.state.stateIncomeTax)}</Row>
          <Row label="Total liability">
            <b>{formatUSD(result.estimate.totalLiability)}</b>
          </Row>
          <Row label="Spouse withholding">{formatUSD(result.estimate.spouseWithholding)}</Row>
          <Row label="Remaining owed">{formatUSD(result.estimate.remainingOwed)}</Row>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
