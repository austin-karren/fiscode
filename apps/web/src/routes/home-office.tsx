import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { Checkbox } from "@fiscode/ui/components/checkbox";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@fiscode/ui/components/field";
import { homeOfficeRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Home } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { GLOSSARY } from "../lib/tax-glossary";

const METHOD_OPTIONS = [
  { value: "simplified", label: "Simplified" },
  { value: "actual", label: "Actual (advanced)" },
];

// Per-field schemas (onBlur). Form-level adds the cross-field "ack required"
// refine and runs on submit.
const fs = {
  startDate: z.date({ message: "Pick a start date" }),
  method: z.enum(["simplified", "actual"], { message: "Pick a method" }),
  officeSqft: z.string(),
  homeSqft: z.string(),
  regularExclusiveAck: z.boolean().refine((v) => v === true, "Acknowledge regular & exclusive use"),
};
const homeOfficeSchema = z.object(fs);

export const Route = createFileRoute("/home-office")({
  loader: async () => ({ rows: await homeOfficeRepo.list() }),
  component: HomeOfficePage,
});

function HomeOfficePage() {
  const { rows } = useLoaderData({ from: "/home-office" });
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      startDate: new Date() as Date | undefined,
      method: "simplified",
      officeSqft: "",
      homeSqft: "",
      regularExclusiveAck: false,
    },
    validators: { onSubmit: homeOfficeSchema },
    onSubmit: async ({ value, formApi }) => {
      await homeOfficeRepo.create({
        startDate: dateToIso(value.startDate!),
        endDate: null,
        method: value.method,
        officeSqft: value.officeSqft ? Number(value.officeSqft) : null,
        homeSqft: value.homeSqft ? Number(value.homeSqft) : null,
        monthlyRentMortgageCents: null,
        monthlyUtilitiesCents: null,
        monthlyInsuranceCents: null,
        regularExclusiveAck: value.regularExclusiveAck,
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
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Add config
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1fr_1fr] @4xl:items-end">
            <TSFormField form={form} name="startDate" validators={{ onBlur: fs.startDate }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Start date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="method">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.homeOfficeMethod}>Method</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      items={METHOD_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="officeSqft">
              {(field) => (
                <FormItem>
                  <FormLabel>Office sqft</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="homeSqft">
              {(field) => (
                <FormItem>
                  <FormLabel>Home sqft</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="regularExclusiveAck"
              validators={{ onBlur: fs.regularExclusiveAck }}
            >
              {(field) => (
                <FormItem className="@sm:col-span-2 @4xl:col-span-4">
                  <FieldLabel htmlFor="regular-exclusive-ack">
                    <Field orientation="horizontal">
                      <FormControl>
                        <Checkbox
                          id="regular-exclusive-ack"
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v === true)}
                        />
                      </FormControl>
                      <FieldContent>
                        <FieldTitle>
                          <LabelWithTooltip tooltip={GLOSSARY.regularExclusive}>
                            Regular &amp; exclusive use
                          </LabelWithTooltip>
                        </FieldTitle>
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
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {rows.map((r) => (
              <DataTable.Row key={r.id}>
                <DataTable.Cell>
                  <span className="font-mono">{r.startDate}</span>
                </DataTable.Cell>
                <DataTable.Cell>
                  <span className="font-mono">{r.endDate ?? "—"}</span>
                </DataTable.Cell>
                <DataTable.Cell>{r.method}</DataTable.Cell>
                <DataTable.Cell align="right">{r.officeSqft ?? "—"}</DataTable.Cell>
                <DataTable.Cell align="right">{r.homeSqft ?? "—"}</DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
