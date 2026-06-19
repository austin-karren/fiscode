import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { optionalIntegerString, optionalNonNegativeIntegerString } from "@fiscode/core";
import { vehicleRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Car } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditVehicleDialog } from "../components/edit-vehicle-dialog";
import { InfoTooltip } from "../components/info-tooltip";
import { GLOSSARY } from "../lib/tax-glossary";

const vehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  // year is integer; mpg is non-negative integer. Both optional (blank → null).
  year: optionalIntegerString,
  mpg: optionalNonNegativeIntegerString,
});
const fs = vehicleSchema.shape;

export const Route = createFileRoute("/vehicles")({
  loader: async () => ({ vehicles: await vehicleRepo.list() }),
  component: VehiclesPage,
});

function VehiclesPage() {
  const { vehicles } = useLoaderData({ from: "/vehicles" });
  const router = useRouter();

  const form = useForm({
    defaultValues: { make: "", model: "", year: "", mpg: "" },
    validators: { onSubmit: vehicleSchema },
    onSubmit: async ({ value, formApi }) => {
      const parsed = vehicleSchema.parse(value);
      await vehicleRepo.create({
        make: parsed.make.trim(),
        model: parsed.model.trim(),
        year: parsed.year,
        mpg: parsed.mpg,
        method: "standard_mileage",
        inServiceDate: null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Vehicle added.");
      formApi.reset();
      router.invalidate();
    },
  });

  const remove = async (id: string) => {
    await vehicleRepo.softDelete(id);
    router.invalidate();
  };

  return (
    <Page
      title="Vehicles"
      description="Vehicles used for business. MPG is informational only — the tax deduction uses business miles × the IRS rate."
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
              Add vehicle
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.5fr_1.5fr_1fr_1fr]">
            <TSFormField form={form} name="make" validators={{ onBlur: fs.make }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Make</FormLabel>
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
            <TSFormField form={form} name="model" validators={{ onBlur: fs.model }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Model</FormLabel>
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
            <TSFormField form={form} name="year">
              {(field) => (
                <FormItem>
                  <FormLabel>Year</FormLabel>
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
            <TSFormField form={form} name="mpg">
              {(field) => (
                <FormItem>
                  <FormLabel>MPG</FormLabel>
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

      {vehicles.length === 0 ? (
        <NoDataEmpty
          icon={Car}
          title="No vehicles yet"
          description="Add a vehicle so mileage entries can reference it."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Make</DataTable.HeaderCell>
              <DataTable.HeaderCell>Model</DataTable.HeaderCell>
              <DataTable.HeaderCell>Year</DataTable.HeaderCell>
              <DataTable.HeaderCell>MPG</DataTable.HeaderCell>
              <DataTable.HeaderCell>
                <span className="inline-flex items-center gap-1.5">
                  Method
                  <InfoTooltip text={GLOSSARY.vehicleMethod} />
                </span>
              </DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {vehicles.map((v) => (
              <DataTable.Row key={v.id}>
                <DataTable.Cell>{v.make}</DataTable.Cell>
                <DataTable.Cell>{v.model}</DataTable.Cell>
                <DataTable.Cell>{v.year ?? "—"}</DataTable.Cell>
                <DataTable.Cell>{v.mpg ?? "—"}</DataTable.Cell>
                <DataTable.Cell>{v.method}</DataTable.Cell>
                <DataTable.Cell align="right">
                  <div className="inline-flex gap-1">
                    <EditVehicleDialog vehicle={v} onSaved={() => router.invalidate()} />
                    <Button variant="ghost" size="sm" onClick={() => remove(v.id)}>
                      Archive
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
