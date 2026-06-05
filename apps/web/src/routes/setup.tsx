import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo, profileRepo } from "@fiscode/db";
import { filingStatusSchema, stateCodeSchema } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { TSFormField } from "../components/forms/ts-form-field";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { StateCombobox } from "../components/forms/state-combobox";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { DatePicker, dateToIso } from "../components/forms/date-picker";

const FILING_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married filing jointly" },
  { value: "mfs", label: "Married filing separately" },
  { value: "hoh", label: "Head of household" },
];

const ENTITY_OPTIONS = [
  { value: "sole_prop", label: "Sole proprietor" },
  { value: "single_member_llc", label: "Single-member LLC" },
  { value: "s_corp", label: "S corp (coming soon)" },
];

// Per-field schemas attached on each Field's `onBlur` so errors surface
// when the user leaves an empty input, not while typing. The form-level
// `setupSchema` re-runs all of them on submit. Keep these in lock-step.
const fieldSchemas = {
  filingStatus: filingStatusSchema.refine((v) => v.length > 0, "Pick a filing status"),
  state: stateCodeSchema,
  seStartDate: z.date({ message: "Pick a start date" }),
  entityType: z.enum(["sole_prop", "single_member_llc"], {
    message: "Pick an entity type",
  }),
};

const setupSchema = z.object(fieldSchemas);

export const Route = createFileRoute("/setup")({
  beforeLoad: async () => {
    if (await profileRepo.exists()) {
      throw redirect({ to: "/" });
    }
  },
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  // Defaults are intentionally empty — the user picks every field. No
  // auto-filled assumptions about filing status, state, start date, or
  // entity type. Submit stays disabled until zod accepts all four.
  const form = useForm({
    defaultValues: {
      filingStatus: "",
      state: "",
      seStartDate: undefined as Date | undefined,
      entityType: "",
    },
    validators: { onSubmit: setupSchema },
    onSubmit: async ({ value }) => {
      // setupSchema (form-level onSubmit) guarantees seStartDate is a Date
      // by the time we reach here. Convert to the ISO string the DB stores.
      const seStartIso = dateToIso(value.seStartDate!);
      try {
        await profileRepo.upsert({
          filingStatus: value.filingStatus,
          state: value.state,
          seStartDate: seStartIso,
          dependents: 0,
          tracksRoth: false,
          usesRetirement: false,
          quarterlyMethod: "annualized",
          prepLeadDays: 14,
        });
        await entityRepo.create({
          type: value.entityType,
          startDate: seStartIso,
          endDate: null,
          notes: null,
          deletedAt: null,
        });
        toast.success("Profile saved.");
        navigate({ to: "/" });
      } catch (err) {
        console.error(err);
        toast.error("Could not save profile.");
      }
    },
  });

  return (
    <Page
      title="Welcome to fiscode"
      description="Just the minimum to get started. Everything else is optional."
    >
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>SETUP</CardHeader>
          <CardContent className="grid gap-4 pb-2">
            <TSFormField
              form={form}
              name="filingStatus"
              validators={{ onBlur: fieldSchemas.filingStatus }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Filing status</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      items={FILING_OPTIONS}
                      placeholder="Pick a filing status…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>

            <TSFormField form={form} name="state" validators={{ onBlur: fieldSchemas.state }}>
              {(field) => (
                <FormItem>
                  <FormLabel>State of residence</FormLabel>
                  <FormControl>
                    <StateCombobox
                      value={field.state.value}
                      onValueChange={(code) => field.handleChange(code)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>

            <TSFormField
              form={form}
              name="seStartDate"
              validators={{ onBlur: fieldSchemas.seStartDate }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Self-employment start date</FormLabel>
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

            <TSFormField
              form={form}
              name="entityType"
              validators={{ onBlur: fieldSchemas.entityType }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Entity type</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      items={ENTITY_OPTIONS}
                      disabledValues={["s_corp"]}
                      placeholder="Pick an entity type…"
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
                  {isSubmitting ? "Saving..." : "Save and continue"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>
    </Page>
  );
}
