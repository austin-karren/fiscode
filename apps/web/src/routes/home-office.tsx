import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FieldCheckbox } from "../components/forms/field-checkbox";
import { FormControl, FormItem, FormMessage, FormDescription } from "@fiscode/ui/components/form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@fiscode/ui/components/field";
import {
  cents,
  formatUSD,
  HOME_OFFICE_METHOD_LABELS,
  labelFor,
  todayIso,
  yearOf,
} from "@fiscode/core";
import { buildBundle, homeOfficeRepo } from "@fiscode/db";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { CircleAlert, Home } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  homeOfficeFieldSchemas,
  overlapsSimplified,
  SECOND_SIMPLIFIED_MESSAGE,
  withAreaCheck,
} from "../lib/home-office-form";
import { deriveYear } from "../lib/tax-input";
import { HomeOfficeFields } from "../components/home-office-fields";
import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { dateToIso } from "../components/forms/date-picker";
import { InfoTooltip } from "../components/info-tooltip";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditHomeOfficeDialog } from "../components/edit-home-office-dialog";
import { GLOSSARY } from "../lib/tax-glossary";
import { useToday } from "../lib/use-today";
import { formatDate } from "../lib/format-date";
import { SectionTitle } from "../components/section-title";

// Per-field schemas (onBlur). Form-level adds the cross-field "ack required"
// refine and runs on submit. sqft inputs are optional non-negative integers —
// blank stays blank (no deduction unless user fills it in), non-numeric is
// rejected up front (previously silently coerced to NaN → null).
const fs = {
  ...homeOfficeFieldSchemas,
  regularExclusiveAck: z.boolean().refine((v) => v === true, "Acknowledge regular & exclusive use"),
};
const homeOfficeSchema = withAreaCheck(z.object(fs));

export const Route = createFileRoute("/home-office")({
  loader: async () => {
    const bundle = await buildBundle();
    const year = yearOf(todayIso());
    // This year's limits, for the notices: area refused, carried, or lost.
    return { rows: await homeOfficeRepo.list(), year, derived: deriveYear(bundle, year) };
  },
  component: HomeOfficePage,
});

function HomeOfficePage() {
  const { rows, year, derived } = useLoaderData({ from: "/home-office" });
  const router = useRouter();
  // Set when a save is refused for a second simplified home in a year.
  const [methodError, setMethodError] = useState<string | undefined>();

  const today = useToday();
  const form = useForm({
    defaultValues: {
      startDate: today as Date | undefined,
      endDate: undefined as Date | undefined,
      method: "simplified",
      officeSqft: "",
      homeSqft: "",
      rentMortgage: "",
      utilities: "",
      insurance: "",
      regularExclusiveAck: false,
    },
    validators: { onSubmit: homeOfficeSchema as never },
    onSubmit: async ({ value, formApi }) => {
      const parsed = homeOfficeSchema.parse(value);
      const startDate = dateToIso(value.startDate!);
      const endDate = value.endDate ? dateToIso(value.endDate) : null;
      setMethodError(undefined);
      if (overlapsSimplified(rows, { method: parsed.method, startDate, endDate })) {
        setMethodError(SECOND_SIMPLIFIED_MESSAGE);
        return;
      }
      // The engine reads the monthly costs for Actual only.
      const actual = parsed.method === "actual";
      await homeOfficeRepo.create({
        startDate,
        endDate,
        method: parsed.method,
        officeSqft: parsed.officeSqft,
        homeSqft: parsed.homeSqft,
        monthlyRentMortgageCents: actual ? parsed.rentMortgage : null,
        monthlyUtilitiesCents: actual ? parsed.utilities : null,
        monthlyInsuranceCents: actual ? parsed.insurance : null,
        regularExclusiveAck: parsed.regularExclusiveAck,
        notes: null,
        deletedAt: null,
      });
      toast.success("Home office config saved.");
      formApi.reset();
      router.invalidate();
    },
  });

  return (
    <Page
      title="Home office"
      description="Each dated config applies until the next one starts. Simplified method: $5/sqft up to 300 sqft (max $1,500/yr)."
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
              <SectionTitle>Add config</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2">
            <HomeOfficeFields form={form} methodError={methodError} />
            <TSFormField
              form={form}
              name="regularExclusiveAck"
              validators={{ onBlur: fs.regularExclusiveAck }}
            >
              {(field) => (
                <FormItem className="relative">
                  {/* The card is one <label>, so its text names the checkbox.
                      The info button stays outside it to keep that name clean. */}
                  <InfoTooltip
                    text={GLOSSARY.regularExclusive}
                    ariaLabel="More info about Regular & exclusive use"
                    className="absolute top-3 right-3 z-10"
                  />
                  {/* The hint as the checkbox's description (see LabelWithTooltip). */}
                  <FormDescription className="sr-only">{GLOSSARY.regularExclusive}</FormDescription>
                  <FieldLabel>
                    <Field orientation="horizontal">
                      <FormControl>
                        <FieldCheckbox
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                          onBlur={field.handleBlur}
                        />
                      </FormControl>
                      <FieldContent>
                        <FieldTitle>Regular &amp; exclusive use</FieldTitle>
                        <FieldDescription>
                          I acknowledge the home office is used regularly and exclusively for
                          business.
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          </CardContent>
          <CardFooter className="justify-end">
            <form.Subscribe
              selector={(s) => ({
                canSubmit: s.canSubmit,
                isSubmitting: s.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      <HomeOfficeNotices year={year} derived={derived} />

      {rows.length === 0 ? (
        <NoDataEmpty
          icon={Home}
          title="No home office config yet"
          description="Save a dated config above. Each new config supersedes the previous one."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Start</DataTable.HeaderCell>
              <DataTable.HeaderCell>End</DataTable.HeaderCell>
              <DataTable.HeaderCell>Method</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Office sqft</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Home sqft</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Monthly costs</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {rows.map((r) => (
              <DataTable.Row key={r.id}>
                <DataTable.Cell label="Start">
                  <span className="whitespace-nowrap">{formatDate(r.startDate)}</span>
                </DataTable.Cell>
                <DataTable.Cell label="End">
                  <span className="whitespace-nowrap">
                    {r.endDate ? formatDate(r.endDate) : "—"}
                  </span>
                </DataTable.Cell>
                <DataTable.Cell label="Method">
                  {labelFor(HOME_OFFICE_METHOD_LABELS, r.method)}
                </DataTable.Cell>
                <DataTable.Cell label="Office sqft" align="right">
                  {r.officeSqft ?? "—"}
                </DataTable.Cell>
                <DataTable.Cell label="Home sqft" align="right">
                  {r.homeSqft ?? "—"}
                </DataTable.Cell>
                <DataTable.Cell label="Monthly costs" align="right">
                  {monthlyCosts(r)}
                </DataTable.Cell>
                <DataTable.Cell align="right">
                  <EditHomeOfficeDialog row={r} rows={rows} onSaved={() => router.invalidate()} />
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}

// An Actual config's monthly costs, summed; "—" for Simplified or none.
const monthlyCosts = (r: {
  method: string;
  monthlyRentMortgageCents: number | null;
  monthlyUtilitiesCents: number | null;
  monthlyInsuranceCents: number | null;
}) => {
  if (r.method !== "actual") return "—";
  const total =
    (r.monthlyRentMortgageCents ?? 0) +
    (r.monthlyUtilitiesCents ?? 0) +
    (r.monthlyInsuranceCents ?? 0);
  return total > 0 ? formatUSD(cents(total)) : "—";
};

/**
 * What this year's limits did to the home office deduction (d-data #53):
 * a config whose office is larger than its home deducts nothing; what the
 * income limit cuts carries to next year's return under Actual (Form 8829
 * line 43) and is lost under Simplified.
 */
function HomeOfficeNotices({
  year,
  derived,
}: {
  year: number;
  derived: { homeOfficeAreaRejected: number; homeOfficeCarryover: number; homeOfficeLost: number };
}) {
  const rejected = derived.homeOfficeAreaRejected;
  return (
    <>
      {rejected > 0 ? (
        <Alert variant="warning">
          <CircleAlert />
          <AlertTitle>
            {rejected === 1 ? "A config has" : `${rejected} configs have`} an office larger than the
            home
          </AlertTitle>
          <AlertDescription>
            {rejected === 1 ? "It deducts" : "They deduct"} $0 in {year}. Edit the square feet
            below.
          </AlertDescription>
        </Alert>
      ) : null}
      {derived.homeOfficeCarryover > 0 ? (
        <Alert>
          <AlertTitle>
            Carries to your {year + 1} return: {formatUSD(cents(derived.homeOfficeCarryover))}
          </AlertTitle>
          <AlertDescription>
            Actual method: the part of the deduction over this year&apos;s business income limit
            carries over on Form 8829 (line 43). fiscode doesn&apos;t track it.
          </AlertDescription>
        </Alert>
      ) : null}
      {derived.homeOfficeLost > 0 ? (
        <Alert>
          <AlertTitle>Not deductible: {formatUSD(cents(derived.homeOfficeLost))}</AlertTitle>
          <AlertDescription>
            Simplified method: the part over this year&apos;s business income limit can&apos;t be
            carried over.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
