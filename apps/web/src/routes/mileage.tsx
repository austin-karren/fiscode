import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { positiveIntegerString } from "@fiscode/core";
import { mileageRepo, profileRepo, vehicleRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Car } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { GLOSSARY } from "../lib/tax-glossary";

const mileageSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  // positiveIntegerString rejects NaN, blanks, decimals, and zero/negative.
  miles: positiveIntegerString,
  vehicleId: z.string(),
  purpose: z.string(),
});
const fs = mileageSchema.shape;

export const Route = createFileRoute("/mileage")({
  loader: async () => ({
    mileage: await mileageRepo.list(),
    vehicles: await vehicleRepo.list(),
    profile: await profileRepo.get(),
  }),
  component: MileagePage,
});

function MileagePage() {
  const { mileage, vehicles, profile } = useLoaderData({ from: "/mileage" });
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      date: new Date() as Date | undefined,
      miles: "",
      vehicleId: "",
      purpose: "",
    },
    validators: { onSubmit: mileageSchema },
    onSubmit: async ({ value, formApi }) => {
      // `value.miles` is parsed by positiveIntegerString → typed number.
      // No Math.round/Number coercion needed; the schema already guarantees
      // a positive integer.
      const parsed = mileageSchema.parse(value);
      await mileageRepo.create({
        date: dateToIso(value.date!),
        vehicleId: value.vehicleId || null,
        businessMiles: parsed.miles,
        purpose: value.purpose || null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Mileage logged.");
      formApi.reset();
      router.invalidate();
    },
  });

  const remove = async (id: string) => {
    await mileageRepo.softDelete(id);
    router.invalidate();
  };

  const vehicleName = (id: string | null) => {
    if (!id) return "—";
    const v = vehicles.find((vv) => vv.id === id);
    return v ? `${v.year ?? ""} ${v.make} ${v.model}`.trim() : "—";
  };

  return (
    <Page
      title="Mileage"
      description="Business miles. Standard mileage method is applied automatically using the year's IRS rate."
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
              Log mileage
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.5fr_2fr]">
            <TSFormField form={form} name="date" validators={{ onBlur: fs.date }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
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
            <TSFormField form={form} name="miles" validators={{ onBlur: fs.miles }}>
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.businessMiles}>
                    Business miles
                  </LabelWithTooltip>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="vehicleId">
              {(field) => (
                <FormItem>
                  <FormLabel>Vehicle</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
                      items={[
                        { value: "__none__", label: "—" },
                        ...vehicles.map((v) => ({
                          value: v.id,
                          label: `${v.make} ${v.model}`,
                        })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="purpose">
              {(field) => (
                <FormItem>
                  <FormLabel>Purpose</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
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
                  {isSubmitting ? "Adding..." : "Add"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      {mileage.length === 0 ? (
        <NoDataEmpty
          icon={Car}
          title="No mileage yet"
          description="Log a business trip above. Total miles × the IRS per-year rate becomes a vehicle deduction."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Date</DataTable.HeaderCell>
              <DataTable.HeaderCell>Vehicle</DataTable.HeaderCell>
              <DataTable.HeaderCell>Purpose</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Miles</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {mileage
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((m) => (
                <DataTable.Row key={m.id}>
                  <DataTable.Cell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono">{m.date}</span>
                      <PreSeStartBadge rowDate={m.date} seStartDate={profile?.seStartDate} />
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>{vehicleName(m.vehicleId)}</DataTable.Cell>
                  <DataTable.Cell>{m.purpose ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{m.businessMiles}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>
                      Delete
                    </Button>
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
