import { Link, createFileRoute, redirect, useLoaderData } from "@tanstack/react-router";
import { Card } from "@fiscode/ui/components/card";
import { buildBundle, profileRepo } from "@fiscode/db";
import { estimateYear, getYearConfig } from "@fiscode/tax";
import { formatUSD, todayIso, yearOf } from "@fiscode/core";

import { buildAnnualizedInput, buildTaxInput, deriveYear } from "../lib/tax-input";
import { Page } from "../components/page";
import { nextDueQuarter, recommendedPrepDate } from "@fiscode/tax";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const exists = await profileRepo.exists();
    if (!exists) throw redirect({ to: "/setup" });
  },
  loader: async () => {
    const bundle = await buildBundle();
    const profile = bundle.profile!;
    const year = yearOf(todayIso());
    const annInput = buildAnnualizedInput(bundle, year);
    const taxInput = buildTaxInput(bundle, year);
    const method = profile.quarterlyMethod === "annualized" ? "annualized" : "even";
    const result = estimateYear({
      entity: "sole_prop", // todo: resolve from active entity
      method,
      input: method === "annualized" ? annInput : taxInput,
    });
    return {
      bundle,
      profile,
      year,
      result,
      derived: deriveYear(bundle, year),
      hasExact: getYearConfig(year).year === year,
    };
  },
  component: Dashboard,
});

function Dashboard() {
  const { profile, year, result, derived, hasExact } = useLoaderData({ from: "/" });
  const today = todayIso();
  const upcoming = nextDueQuarter(result.quarterly, today);
  const recommendedPrep = upcoming
    ? recommendedPrepDate(upcoming.dueDate, profile.prepLeadDays)
    : undefined;

  return (
    <Page
      title={`${year} estimate`}
      description={`${profile.filingStatus.toUpperCase()} · ${profile.state} · ${profile.quarterlyMethod === "annualized" ? "annualized installments" : "even quarters"}`}
      actions={
        <Link
          to="/data"
          className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          Export CSV
        </Link>
      }
    >
      {!hasExact ? (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          <strong>Year config missing.</strong> Showing values from a nearby year. Verify tax
          figures against the IRS / SSA before relying on these numbers.
        </div>
      ) : null}

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total liability</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUSD(result.estimate.totalLiability)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Self-employment tax</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUSD(result.estimate.se.totalSeTax)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Federal income tax</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUSD(result.estimate.federal.federalIncomeTax)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">State income tax</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUSD(result.estimate.state.stateIncomeTax)}
          </p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Quarterly payments
        </h2>
        <div className="grid gap-2 @md:grid-cols-4">
          {result.quarterly.payments.map((p) => {
            const past = p.dueDate < today;
            const isNext = upcoming?.quarter === p.quarter;
            return (
              <div
                key={p.quarter}
                className={`rounded-md border border-border p-3 ${
                  isNext ? "ring-1 ring-foreground/40" : ""
                } ${past ? "opacity-60" : ""}`}
              >
                <p className="text-xs text-muted-foreground">
                  Q{p.quarter} · {p.periodStart} → {p.periodEnd}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatUSD(p.amount)}</p>
                <p className="mt-1 text-xs">
                  due <span className="font-mono">{p.dueDate}</span>
                  {past ? " (past)" : isNext ? " (next)" : ""}
                </p>
              </div>
            );
          })}
        </div>
        {upcoming && recommendedPrep ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Next due <span className="font-mono">{upcoming.dueDate}</span>. Start preparing around{" "}
            <span className="font-mono">{recommendedPrep}</span>.
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">Safe harbor</h2>
        <div className="grid gap-3 @md:grid-cols-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">90% of current year</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatUSD(result.safeHarbor.currentYearTarget)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {result.safeHarbor.firstYear
                ? "Prior year"
                : `${(result.safeHarbor.multiplierUsed! * 100).toFixed(0)}% of prior year`}
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {result.safeHarbor.firstYear
                ? "n/a (first year)"
                : formatUSD(result.safeHarbor.priorYearTarget!)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Floor (lower of two)</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatUSD(result.safeHarbor.floor)}
            </p>
          </div>
        </div>
        {result.safeHarbor.firstYear ? (
          <p className="mt-3 text-sm text-yellow-600/90">
            First-year filing: pay-as-you-go target is 90% of current-year tax. Owing the full
            balance at filing is allowed, but underpayment penalty risk applies if you pay too
            little throughout the year.
          </p>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Year-to-date inputs
        </h2>
        <dl className="grid gap-2 text-sm @md:grid-cols-2">
          <div className="flex justify-between">
            <dt>1099 income</dt>
            <dd className="tabular-nums">{formatUSD(derived.gross1099)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Direct expenses</dt>
            <dd className="tabular-nums">{formatUSD(derived.directExpenses)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Mileage deduction</dt>
            <dd className="tabular-nums">{formatUSD(derived.mileageDeduction)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Home office</dt>
            <dd className="tabular-nums">{formatUSD(derived.homeOfficeDeduction)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Net profit</dt>
            <dd className="tabular-nums">{formatUSD(result.estimate.netProfit)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>QBI deduction</dt>
            <dd className="tabular-nums">{formatUSD(result.estimate.federal.qbiDeduction)}</dd>
          </div>
        </dl>
      </Card>
    </Page>
  );
}
