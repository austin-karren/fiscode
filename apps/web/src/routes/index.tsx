import { createFileRoute, redirect, useLoaderData } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { buildBundle, profileRepo } from "@fiscode/db";
import { estimateYear, getYearConfig, nextDueQuarter, recommendedPrepDate } from "@fiscode/tax";
import { formatUSD, todayIso, yearOf, type Cents } from "@fiscode/core";
import { CircleAlert } from "lucide-react";

import { buildAnnualizedInput, buildTaxInput, deriveYear } from "../lib/tax-input";
import { GLOSSARY } from "../lib/tax-glossary";
import { Page } from "../components/page";
import { ExportCard } from "../components/export-card";
import { ImportCard } from "../components/import-card";
import { BackupNudge } from "../components/backup-nudge";
import { InfoTooltip } from "../components/info-tooltip";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (!(await profileRepo.exists())) {
      throw redirect({ to: "/setup" });
    }
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
  const { profile, year, result, derived, hasExact } = useLoaderData({
    from: "/",
  });
  const today = todayIso();
  const upcoming = nextDueQuarter(result.quarterly, today);
  const recommendedPrep = upcoming
    ? recommendedPrepDate(upcoming.dueDate, profile.prepLeadDays)
    : undefined;

  return (
    <Page
      title={`${year} estimate`}
      description={`${profile.filingStatus.toUpperCase()} · ${profile.state} · ${profile.quarterlyMethod === "annualized" ? "annualized installments" : "even quarters"}`}
    >
      {!hasExact ? (
        <Alert>
          <CircleAlert />
          <AlertTitle>Year config missing</AlertTitle>
          <AlertDescription>
            Showing values from a nearby year. Verify tax figures against the IRS / SSA before
            relying on these numbers.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-4">
        <StatCard
          label="Total liability"
          value={result.estimate.totalLiability}
          tooltip={GLOSSARY.totalLiability}
        />
        <StatCard
          label="Self-employment tax"
          value={result.estimate.se.totalSeTax}
          tooltip={GLOSSARY.seTax}
        />
        <StatCard
          label="Federal income tax"
          value={result.estimate.federal.federalIncomeTax}
          tooltip={GLOSSARY.federalIncomeTax}
        />
        <StatCard
          label="State income tax"
          value={result.estimate.state.stateIncomeTax}
          tooltip={GLOSSARY.stateIncomeTax}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1.5 text-sm font-medium uppercase text-muted-foreground">
            Quarterly payments
            <InfoTooltip text={GLOSSARY.unevenQuarters} />
          </CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1.5 text-sm font-medium uppercase text-muted-foreground">
            Safe harbor
            <InfoTooltip text={GLOSSARY.safeHarbor} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 @md:grid-cols-3 text-sm">
            <Field label="90% of current year" tooltip={GLOSSARY.safeHarborCurrent}>
              {formatUSD(result.safeHarbor.currentYearTarget)}
            </Field>
            <Field
              label={
                result.safeHarbor.firstYear
                  ? "Prior year"
                  : `${(result.safeHarbor.multiplierUsed! * 100).toFixed(0)}% of prior year`
              }
              tooltip={GLOSSARY.safeHarborPrior}
            >
              {result.safeHarbor.firstYear
                ? "n/a (first year)"
                : formatUSD(result.safeHarbor.priorYearTarget!)}
            </Field>
            <Field label="Floor (lower of two)" tooltip={GLOSSARY.safeHarborFloor}>
              {formatUSD(result.safeHarbor.floor)}
            </Field>
          </div>
          {result.safeHarbor.firstYear ? (
            <p className="mt-3 text-sm text-yellow-600/90 dark:text-yellow-300">
              First-year filing: pay-as-you-go target is 90% of current-year tax. Owing the full
              balance at filing is allowed, but underpayment penalty risk applies if you pay too
              little throughout the year.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Year-to-date inputs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm @md:grid-cols-2">
            <Row
              label="1099 income"
              value={formatUSD(derived.gross1099)}
              tooltip={GLOSSARY.income1099}
            />
            <Row label="Direct expenses" value={formatUSD(derived.directExpenses)} />
            <Row
              label="Mileage deduction"
              value={formatUSD(derived.mileageDeduction)}
              tooltip={GLOSSARY.standardMileage}
            />
            <Row label="Home office" value={formatUSD(derived.homeOfficeDeduction)} />
            <Row
              label="Net profit"
              value={formatUSD(result.estimate.netProfit)}
              emphasis
              tooltip={GLOSSARY.netProfit}
            />
            <Row
              label="QBI deduction"
              value={formatUSD(result.estimate.federal.qbiDeduction)}
              tooltip={GLOSSARY.qbi}
            />
          </dl>
        </CardContent>
      </Card>

      <section id="data" className="grid gap-4 @md:grid-cols-2 @xl:grid-cols-3 pt-2">
        <ExportCard />
        <ImportCard />
        <BackupNudge />
      </section>
    </Page>
  );
}

function StatCard({ label, value, tooltip }: { label: string; value: Cents; tooltip?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="inline-flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
          {label}
          {tooltip ? <InfoTooltip text={tooltip} /> : null}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatUSD(value)}</p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </p>
      <p className="text-lg font-semibold tabular-nums">{children}</p>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
  tooltip,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tooltip?: string;
}) {
  return (
    <div className={`flex justify-between ${emphasis ? "font-medium" : ""}`}>
      <dt className="inline-flex items-center gap-1.5">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
