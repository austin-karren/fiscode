import { useRef } from "react";
import { createFileRoute, useLoaderData, useLocation, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from "@fiscode/ui/components/form";
import { mileageRepo, profileRepo, vehicleRepo, documentLinkRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Car } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { tripMiles } from "../lib/field-schemas";
import { Page } from "../components/page";
import { AttachDialog } from "../components/documents/attach-dialog";
import { rowAnchor } from "../lib/documents-links";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso, isoToDate } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { InfoTooltip } from "../components/info-tooltip";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditMileageDialog } from "../components/edit-mileage-dialog";
import { ParentName } from "../components/parent-name";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { GLOSSARY } from "../lib/tax-glossary";
import { useToday } from "../lib/use-today";
import { formatDate } from "../lib/format-date";
import { SectionTitle } from "../components/section-title";
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { recordLabel } from "../lib/record-label";

const mileageSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  miles: tripMiles,
  vehicleId: z.string(),
  purpose: z.string(),
});
const fs = mileageSchema.shape;

export const Route = createFileRoute("/mileage")({
  loader: async () => {
    const mileageRows = await mileageRepo.list();
    return {
      mileage: mileageRows,
      // Documents per row, in one query for the screen.
      linkCounts: await documentLinkRepo.countsFor(
        "mileage",
        mileageRows.map((r) => r.id),
      ),
      // Archived vehicles too: old rows keep showing their vehicle's name.
      vehicles: await vehicleRepo.listIncludingDeleted(),
      profile: await profileRepo.get(),
    };
  },
  component: MileagePage,
});

function MileagePage() {
  const {
    mileage,
    vehicles: allVehicles,
    profile,
    linkCounts,
  } = useLoaderData({ from: "/mileage" });
  const hash = useLocation({ select: (l) => l.hash });
  const router = useRouter();
  // Only live vehicles can be picked for a new entry.
  const vehicles = allVehicles.filter((v) => !v.deletedAt);

  const today = useToday();
  const empty = {
    date: today as Date | undefined,
    miles: "",
    vehicleId: "",
    purpose: "",
  };
  // The add card, and its first value field: focus targets after Add and Duplicate.
  const addCard = useRef<HTMLDivElement>(null);
  const firstValue = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: empty,
    validators: { onSubmit: mileageSchema },
    onSubmit: async ({ value, formApi }) => {
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
      // A run of trips shares the date and the vehicle: keep those, clear the rest.
      formApi.reset(
        { ...empty, date: value.date, vehicleId: value.vehicleId },
        { keepDefaultValues: true },
      );
      router.invalidate();
      firstValue.current?.focus();
    },
  });

  // Fills the add form with a row's values, and puts focus on its date, the
  // value a copy most often changes.
  const duplicate = (row: (typeof mileage)[number]) => {
    form.reset(
      {
        date: isoToDate(row.date) ?? today,
        miles: String(row.businessMiles),
        // An archived vehicle cannot be picked for a new trip.
        vehicleId: vehicles.some((v) => v.id === row.vehicleId) ? (row.vehicleId ?? "") : "",
        purpose: row.purpose ?? "",
      },
      { keepDefaultValues: true },
    );
    // The first form control is the date field's trigger; FormControl gives each
    // control an id ending in "-form-item". Focus also scrolls it into view.
    addCard.current?.querySelector<HTMLElement>('[id$="-form-item"]')?.focus();
  };

  // Focus moves to the next row (or the table) once this one is gone.
  const remove = async (row: (typeof mileage)[number], from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    await softDeleteWithUndo({
      repo: mileageRepo,
      row,
      message: "Mileage entry deleted.",
      undoneMessage: "Mileage entry restored.",
      onChange: () => router.invalidate(),
    });
    await router.invalidate();
    refocus();
  };

  const vehicleParent = (id: string | null) => {
    const v = allVehicles.find((vv) => vv.id === id);
    return v
      ? { name: `${v.year ?? ""} ${v.make} ${v.model}`.trim(), deletedAt: v.deletedAt }
      : undefined;
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
        <Card ref={addCard}>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Log mileage</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.5fr_2fr]">
            <TSFormField
              form={form}
              name="date"
              requirement="required"
              validators={{ onBlur: fs.date }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => field.handleChange(d)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={form}
              name="miles"
              requirement="required"
              validators={{ onBlur: fs.miles }}
            >
              {(field) => (
                // The hint button comes after the box in the DOM, so Tab reaches
                // the field first; the grid still shows it beside the label.
                <FormItem className="grid-cols-[auto_1fr] items-center gap-x-1.5">
                  <FormLabel className="col-start-1 row-start-1">Business miles</FormLabel>
                  <FormControl>
                    <Input
                      ref={firstValue}
                      type="text"
                      inputMode="numeric"
                      className="col-span-2"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <span className="col-start-2 row-start-1 inline-flex">
                    <InfoTooltip text={GLOSSARY.businessMiles} />
                  </span>
                  <FormDescription className="sr-only">{GLOSSARY.businessMiles}</FormDescription>
                  <FormMessage className="col-span-2" />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="vehicleId" requirement="optional">
              {(field) => (
                <FormItem>
                  <FormLabel>Vehicle</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onBlur={field.handleBlur}
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
            <TSFormField form={form} name="purpose" requirement="optional">
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
                <DataTable.Row
                  key={m.id}
                  id={rowAnchor(m.id)}
                  highlighted={hash === rowAnchor(m.id)}
                >
                  <DataTable.Cell label="Date">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="whitespace-nowrap">{formatDate(m.date)}</span>
                      <PreSeStartBadge rowDate={m.date} seStartDate={profile?.seStartDate} />
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell label="Vehicle">
                    <ParentName parent={vehicleParent(m.vehicleId)} />
                  </DataTable.Cell>
                  <DataTable.Cell label="Purpose">{m.purpose ?? "—"}</DataTable.Cell>
                  <DataTable.Cell label="Miles" align="right">
                    {m.businessMiles}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditMileageDialog
                        mileage={m}
                        vehicles={allVehicles}
                        onSaved={() => router.invalidate()}
                      />
                      <AttachDialog
                        recordType="mileage"
                        recordId={m.id}
                        recordDate={m.date}
                        recordLabel={recordLabel.mileage(m)}
                        count={linkCounts[m.id] ?? 0}
                        onChanged={() => router.invalidate()}
                      />
                      <Button variant="ghost" size="sm" onClick={() => duplicate(m)}>
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => void remove(m, e.currentTarget)}
                      >
                        Delete <span className="sr-only">{recordLabel.mileage(m)}</span>
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
