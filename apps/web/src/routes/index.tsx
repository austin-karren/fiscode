import { createFileRoute, Link, redirect, useLoaderData } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { buildBundle, profileRepo } from "@fiscode/db";
import {
  estimateBundleYear,
  type DerivedYear,
  getYearConfig,
  nextDueQuarter,
  recommendedPrepDate,
} from "@fiscode/tax";
import {
  FILING_STATUS_LABELS,
  formatUSD,
  labelFor,
  todayIso,
  yearOf,
  type Cents,
} from "@fiscode/core";
import { Badge } from "@fiscode/ui/components/badge";
import { CircleAlert } from "lucide-react";
import { StartupIgnoredNotice } from "../components/startup-ignored-notice";
import { PaidVsTarget } from "../components/paid-vs-target";

import { EntityUnsupportedAlert } from "../components/entity-unsupported-alert";
import { GLOSSARY } from "../lib/tax-glossary";
import { Page } from "../components/page";
import { ExportCard } from "../components/export-card";
import { ImportCard } from "../components/import-card";
import { BackupCard } from "../components/backup-card";
import { BackupNudge } from "../components/backup-nudge";
import { InfoTooltip } from "../components/info-tooltip";
import { UtahPrepaymentLine } from "../components/utah-prepayment-line";
import { formatDate } from "../lib/format-date";
import { US_STATE_BY_CODE } from "../lib/us-states";
import { SectionTitle } from "../components/section-title";

// "Single filer · Utah · annualized installments": the profile's settings
// that shape this estimate, in words. "Single" alone reads like an adjective
// in a list, so it gets "filer"; the other statuses already read as one.
const dashboardSubtitle = (profile: {
  filingStatus: string;
  state: string;
  quarterlyMethod: string;
}): string => {
  const filing =
    profile.filingStatus === "single"
      ? "Single filer"
      : labelFor(FILING_STATUS_LABELS, profile.filingStatus);
  const state = US_STATE_BY_CODE[profile.state] ?? profile.state;
  const method =
    profile.quarterlyMethod === "annualized" ? "annualized installments" : "even quarters";
  return `${filing} · ${state} · ${method}`;
};

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
    const { result, derived } = estimateBundleYear(bundle, year);
    // DF-07 (d-data #79): paid against what is due, and why the prior-year safe harbor applies.
    const payments = result.payments;
    const priorYearBasis =
      result.safeHarbor.priorYearBasis ?? (result.safeHarbor.firstYear ? "not_entered" : "entered");
    return {
      bundle,
      profile,
      year,
      result,
      derived,
      payments,
      priorYearBasis,
      hasExact: getYearConfig(year).year === year,
    };
  },
  component: Dashboard,
});

function Dashboard() {
  const { profile, year, result, derived, hasExact, payments, priorYearBasis } = useLoaderData({
    from: "/",
  });
  const today = todayIso();
  const upcoming = nextDueQuarter(result.quarterly, today);
  // The $1,000 rule (packages/tax): no federal estimated payment is required.
  const noPayment = result.quarterly.noInstallmentsRequired === true;
  const recommendedPrep = upcoming
    ? recommendedPrepDate(upcoming.dueDate, profile.prepLeadDays)
    : undefined;

  return (
    <Page title={`${year} estimate`} description={dashboardSubtitle(profile)}>
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

      <EntityUnsupportedAlert derived={derived} />
      <ExcludedBeforeSeAlert derived={derived} />
      <OfficeAreaAlert rejected={derived.homeOfficeAreaRejected} />
      <Section179Notice count={derived.equipmentAssumedSection179} />
      <StartupIgnoredNotice count={derived.startupIgnoredForEquipment} />
      {/* "Didn't file" answers the question the notice asks. */}
      {priorYearBasis === "not_filed" ? (
        <NotFiledAlert year={year} />
      ) : (
        <PriorYearReturnNotice applied={derived.priorYearFiguresApplied} year={year} />
      )}

      {/* One primary figure, the year's total; the three taxes it adds up
          recede beside it. */}
      <div className="grid items-stretch gap-4 @md:grid-cols-3 @xl:grid-cols-[2fr_1fr_1fr_1fr]">
        <StatCard
          primary
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
          <CardTitle>
            <SectionTitle>
              IRS quarterly payments (federal)
              <InfoTooltip text={GLOSSARY.unevenQuarters} />
            </SectionTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 @md:grid-cols-4">
            {result.quarterly.payments.map((p) => {
              const past = p.dueDate < today;
              // Under the $1,000 rule no quarter is due, so none is "next".
              const isNext = !noPayment && upcoming?.quarter === p.quarter;
              return (
                <div
                  key={p.quarter}
                  className={`rounded-md border border-border p-3 ${
                    isNext ? "ring-1 ring-foreground/40" : ""
                  } ${past ? "border-dashed text-muted-foreground" : ""}`}
                >
                  <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Q{p.quarter} · {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                    </span>
                    {isNext ? <Badge variant="secondary">Next</Badge> : null}
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{formatUSD(p.amount)}</p>
                  <p className="mt-1 text-xs">
                    {past
                      ? `Was due ${formatDate(p.dueDate)}`
                      : noPayment
                        ? "No payment required"
                        : `Due ${formatDate(p.dueDate)}`}
                  </p>
                </div>
              );
            })}
          </div>
          {noPayment ? (
            <p className="mt-3 text-sm">
              <span className="font-medium">No payment required.</span>{" "}
              <span className="text-muted-foreground">
                You owe the IRS less than $1,000 after federal withholding, so there is no federal
                underpayment penalty.
              </span>
            </p>
          ) : null}
          {result.statePrepayment ? (
            <UtahPrepaymentLine prepayment={result.statePrepayment} />
          ) : null}
          {/* Under the $1,000 rule there is nothing to prepare for. */}
          {!noPayment && upcoming && recommendedPrep ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Next due {formatDate(upcoming.dueDate)}. Start preparing around{" "}
              {formatDate(recommendedPrep)}.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <PaidVsTarget payments={payments} today={today} noneRequired={noPayment} />

      <Card>
        <CardHeader>
          <CardTitle>
            <SectionTitle>
              Safe harbor (federal)
              <InfoTooltip text={GLOSSARY.safeHarbor} />
            </SectionTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 @md:grid-cols-3 text-sm">
            <Field label="90% of current year" tooltip={GLOSSARY.safeHarborCurrent}>
              {formatUSD(result.safeHarbor.currentYearTarget)}
            </Field>
            {/* The engine's firstYear means only "no prior-year figures entered".
                It never decides that someone didn't file: a new SE filer may have
                a W-2 return, so it reads "not entered" whatever the SE start. */}
            <Field
              label={
                result.safeHarbor.firstYear
                  ? "Prior year"
                  : `${(result.safeHarbor.multiplierUsed! * 100).toFixed(0)}% of prior year`
              }
              tooltip={GLOSSARY.safeHarborPrior}
              note={
                result.safeHarbor.multiplierReason === "agi_not_entered"
                  ? "AGI not entered, so 110%."
                  : undefined
              }
            >
              {result.safeHarbor.firstYear
                ? priorYearBasis === "not_filed"
                  ? "not filed"
                  : "not entered"
                : formatUSD(result.safeHarbor.priorYearTarget!)}
            </Field>
            <Field label="Floor (lower of two)" tooltip={GLOSSARY.safeHarborFloor}>
              {formatUSD(result.safeHarbor.floor)}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <SectionTitle>Year-to-date inputs</SectionTitle>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 gap-x-12 text-sm @md:grid-cols-2">
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

      <section id="data" className="grid items-start gap-4 pt-2 @md:grid-cols-2 @xl:grid-cols-3">
        <ExportCard />
        <ImportCard />
        <BackupCard />
        <BackupNudge />
      </section>
    </Page>
  );
}

function StatCard({
  label,
  value,
  tooltip,
  primary = false,
}: {
  label: string;
  value: Cents;
  tooltip?: string;
  /** The page's main figure: larger, and full width until the row has room. */
  primary?: boolean;
}) {
  return (
    <Card className={primary ? "@md:col-span-3 @xl:col-span-1" : undefined}>
      <CardContent className="pt-6">
        <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {label}
          {tooltip ? <InfoTooltip text={tooltip} /> : null}
        </p>
        <p
          className={
            primary
              ? "mt-1 text-4xl font-semibold tracking-tight tabular-nums"
              : "mt-1 text-lg font-medium tabular-nums text-muted-foreground"
          }
        >
          {formatUSD(value)}
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  tooltip,
  note,
}: {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
  /** One short line under the value: why it is what it is. */
  note?: string;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </p>
      <p className="text-lg font-semibold tabular-nums">{children}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
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

// A home office config whose office is larger than its home deducts $0
// (d-data #53). One line, with the way to fix it.
function OfficeAreaAlert({ rejected }: { rejected: number }) {
  if (!rejected) return null;
  return (
    <Alert variant="warning">
      <CircleAlert />
      <AlertDescription>
        {rejected === 1 ? "A home office config has" : `${rejected} home office configs have`} an
        office larger than the home, so {rejected === 1 ? "it deducts" : "they deduct"} $0. Fix the
        square feet in <Link to="/home-office">Home office</Link>.
      </AlertDescription>
    </Alert>
  );
}

// fiscode deducts equipment in full. Above the de minimis safe harbor ("up to $2,500 per item or
// invoice", Pub 334) that assumes a section 179 election; say so, without changing a number.
function Section179Notice({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Alert>
      <CircleAlert />
      <AlertDescription>
        {count === 1 ? "An equipment expense" : `${count} equipment expenses`} over $2,500{" "}
        {count === 1 ? "is" : "are"} deducted in full this year, which assumes a Section 179
        election. Tick §179 candidate in <Link to="/expenses">Expenses</Link> to confirm, and check
        it with your accountant.
      </AlertDescription>
    </Alert>
  );
}

// "I didn't file a <year-1> return" (Profile): the prior-year safe harbor isn't available, so the
// target is 90% of this year's tax (i2210 line 8). Shown only for that answer, never assumed.
function NotFiledAlert({ year }: { year: number }) {
  return (
    <Alert variant="warning">
      <CircleAlert />
      <AlertTitle>No {year - 1} return filed</AlertTitle>
      <AlertDescription>
        The pay-as-you-go target is 90% of this year's tax. Owing the full balance at filing is
        allowed, but underpayment penalty risk applies if you pay too little through the year.
      </AlertDescription>
    </Alert>
  );
}

// The prior-year safe harbor needs the return for the year before this one (Pub 505: "the total
// tax shown on your 2025 return" for 2026). Without it the floor is 90% of this year's tax. A new SE
// filer may still have one (a W-2 job), so it asks rather than assumes; the card says only "not entered".
function PriorYearReturnNotice({ applied, year }: { applied: boolean | undefined; year: number }) {
  if (applied !== false) return null;
  return (
    <Alert>
      <CircleAlert />
      <AlertDescription>
        Filed a {year - 1} return (W-2 or otherwise)? Enter it on <Link to="/profile">Profile</Link>{" "}
        to use the prior-year safe harbor.
      </AlertDescription>
    </Alert>
  );
}

function ExcludedBeforeSeAlert({ derived }: { derived: DerivedYear }) {
  const { income, expense, mileage } = derived.excludedBeforeSeStart;
  const total = income + expense + mileage;
  if (total === 0) return null;
  const parts: string[] = [];
  if (income) parts.push(`${income} income entr${income === 1 ? "y" : "ies"}`);
  if (expense) parts.push(`${expense} expense${expense === 1 ? "" : "s"}`);
  if (mileage) parts.push(`${mileage} mileage trip${mileage === 1 ? "" : "s"}`);
  const summary = parts.join(", ");
  const one = total === 1;
  return (
    <Alert variant="warning">
      <CircleAlert />
      <AlertTitle>Some rows are dated before your SE start date</AlertTitle>
      <AlertDescription>
        {summary} dated before {formatDate(derived.seStartDate)} {one ? "is" : "are"} not counted in
        this estimate. {one ? "It stays" : "They stay"} in your data — edit {one ? "it" : "them"} or
        change your start date on <Link to="/profile">your profile</Link>.
      </AlertDescription>
    </Alert>
  );
}
