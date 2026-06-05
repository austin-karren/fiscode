import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { clientRepo, profileRepo, timeRepo } from "@fiscode/db";
import { useForm } from "@tanstack/react-form";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { PreSeStartBadge } from "../components/pre-se-start-badge";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";

const timeSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  hours: z.string().refine((v) => Number(v) > 0, "Enter hours worked"),
  clientId: z.string(),
  description: z.string(),
});
const fs = timeSchema.shape;

const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};

export const Route = createFileRoute("/time")({
  loader: async () => ({
    entries: await timeRepo.list(),
    clients: await clientRepo.list(),
    profile: await profileRepo.get(),
  }),
  component: TimePage,
});

function TimePage() {
  const { entries, clients, profile } = useLoaderData({ from: "/time" });
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      date: new Date() as Date | undefined,
      hours: "",
      clientId: "",
      description: "",
    },
    validators: { onSubmit: timeSchema },
    onSubmit: async ({ value, formApi }) => {
      await timeRepo.create({
        date: dateToIso(value.date!),
        clientId: value.clientId || null,
        minutes: Math.round(Number(value.hours) * 60),
        description: value.description || null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Time entry added.");
      formApi.reset();
      router.invalidate();
    },
  });

  const remove = async (id: string) => {
    await timeRepo.softDelete(id);
    router.invalidate();
  };

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "—") : "—";

  return (
    <Page
      title="Time"
      description="Tracked for your own visibility. Time does not feed the tax estimate — income entries do."
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
              Log time
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-[1.1fr_1fr_1.5fr_2fr] @4xl:items-end">
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
            <TSFormField form={form} name="hours" validators={{ onBlur: fs.hours }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Hours</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.25"
                      min="0.25"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="clientId">
              {(field) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value || "__none__"}
                      onValueChange={(v) => field.handleChange(v === "__none__" ? "" : v)}
                      items={[
                        { value: "__none__", label: "—" },
                        ...clients.map((c) => ({
                          value: c.id,
                          label: c.name,
                        })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={form} name="description">
              {(field) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
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

      {entries.length === 0 ? (
        <NoDataEmpty
          icon={Clock}
          title="No time entries yet"
          description="Log hours for your own visibility. Tax calculations rely on income entries, not time."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Date</DataTable.HeaderCell>
              <DataTable.HeaderCell>Client</DataTable.HeaderCell>
              <DataTable.HeaderCell>Description</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Time</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {entries
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((t) => (
                <DataTable.Row key={t.id}>
                  <DataTable.Cell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono">{t.date}</span>
                      <PreSeStartBadge rowDate={t.date} seStartDate={profile?.seStartDate} />
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell>{clientName(t.clientId)}</DataTable.Cell>
                  <DataTable.Cell>{t.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatMinutes(t.minutes)}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(t.id)}>
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
