import { useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { mileageRepo, vehicleRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Car } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { optionalMpg, optionalVehicleYear } from "../lib/field-schemas";
import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditVehicleDialog } from "../components/edit-vehicle-dialog";
import { ArchiveDialog } from "../components/archive-dialog";
import { ArchivedNote } from "../components/parent-name";
import { restoreRow, softDeleteWithUndo } from "../lib/soft-delete";
import { InfoTooltip } from "../components/info-tooltip";
import { GLOSSARY } from "../lib/tax-glossary";
import { VEHICLE_METHOD_LABELS, labelFor } from "@fiscode/core";

const vehicleSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  // Both optional: blank is stored as null.
  year: optionalVehicleYear,
  mpg: optionalMpg,
});
const fs = vehicleSchema.shape;

export const Route = createFileRoute("/vehicles")({
  loader: async () => ({
    // Archived vehicles too, for the "Show archived" view.
    vehicles: await vehicleRepo.listIncludingDeleted(),
    // Mileage rows point at a vehicle; counted in the archive dialog.
    mileage: await mileageRepo.list(),
  }),
  component: VehiclesPage,
});

function VehiclesPage() {
  const { vehicles: allVehicles, mileage } = useLoaderData({ from: "/vehicles" });
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = allVehicles.filter((v) => v.deletedAt).length;
  const vehicles = allVehicles.filter((v) => showArchived || !v.deletedAt);
  const nameOf = (v: (typeof allVehicles)[number]) => `${v.make} ${v.model}`;

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

  const archive = (vehicle: (typeof allVehicles)[number]) =>
    softDeleteWithUndo({
      repo: vehicleRepo,
      row: vehicle,
      message: `${nameOf(vehicle)} archived.`,
      undoneMessage: `${nameOf(vehicle)} restored.`,
      onChange: () => router.invalidate(),
    });

  const unarchive = (vehicle: (typeof allVehicles)[number]) =>
    restoreRow({
      repo: vehicleRepo,
      row: vehicle,
      message: `${nameOf(vehicle)} un-archived.`,
      onChange: () => router.invalidate(),
    });

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
            <TSFormField
              form={form}
              name="make"
              requirement="required"
              validators={{ onBlur: fs.make }}
            >
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
            <TSFormField
              form={form}
              name="model"
              requirement="required"
              validators={{ onBlur: fs.model }}
            >
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
            <TSFormField
              form={form}
              name="year"
              requirement="optional"
              validators={{ onBlur: fs.year }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Year</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
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
              name="mpg"
              requirement="optional"
              validators={{ onBlur: fs.mpg }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>MPG</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
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

      <div className="flex flex-col gap-2">
        {archivedCount > 0 ? (
          <div className="flex justify-end">
            <Button
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              Show archived ({archivedCount})
            </Button>
          </div>
        ) : null}
        {vehicles.length === 0 ? (
          <NoDataEmpty
            icon={Car}
            title={archivedCount > 0 ? "No active vehicles" : "No vehicles yet"}
            description={
              archivedCount > 0
                ? "Every vehicle is archived. Use “Show archived” above to see or un-archive them, or add a new vehicle."
                : "Add a vehicle so mileage entries can reference it."
            }
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
                  <DataTable.Cell>
                    {v.model}
                    {v.deletedAt ? <ArchivedNote /> : null}
                  </DataTable.Cell>
                  <DataTable.Cell>{v.year ?? "—"}</DataTable.Cell>
                  <DataTable.Cell>{v.mpg ?? "—"}</DataTable.Cell>
                  <DataTable.Cell>{labelFor(VEHICLE_METHOD_LABELS, v.method)}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    {v.deletedAt ? (
                      <Button variant="ghost" size="sm" onClick={() => unarchive(v)}>
                        Un-archive
                      </Button>
                    ) : (
                      <div className="inline-flex gap-1">
                        <EditVehicleDialog vehicle={v} onSaved={() => router.invalidate()} />
                        <ArchiveDialog
                          itemName={nameOf(v)}
                          references={[
                            {
                              count: mileage.filter((m) => m.vehicleId === v.id).length,
                              singular: "mileage entry",
                              plural: "mileage entries",
                            },
                          ]}
                          onConfirm={() => archive(v)}
                        />
                      </div>
                    )}
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
            </DataTable.Body>
          </DataTable>
        )}
      </div>
    </Page>
  );
}
