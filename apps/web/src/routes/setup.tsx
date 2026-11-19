import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo, profileRepo } from "@fiscode/db";
import {
  ENTITY_TYPE_LABELS,
  FILING_STATUS_LABELS,
  filingStatusSchema,
  labelOptions,
  stateCodeSchema,
} from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { TSFormField } from "../components/forms/ts-form-field";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { StateCombobox } from "../components/forms/state-combobox";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { CONFIG_YEARS_BACK, DatePicker, dateToIso } from "../components/forms/date-picker";
import { LabelWithTooltip } from "../components/forms/labeled";
import { GLOSSARY } from "../lib/tax-glossary";
import { ImportCard } from "../components/import-card";

const FILING_OPTIONS = labelOptions(FILING_STATUS_LABELS);

// S corp is listed and disabled: the estimate does not handle it yet.
const ENTITY_OPTIONS = labelOptions(ENTITY_TYPE_LABELS).map((o) =>
  o.value === "s_corp" ? { ...o, label: `${o.label} (coming soon)` } : o,
);

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
  const router = useRouter();
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
        // A backup restored on this screen without a profile row may already
        // have brought the business entity. A second open-ended one would
        // overlap it.
        if ((await entityRepo.list()).length === 0) {
          await entityRepo.create({
            type: value.entityType,
            startDate: seStartIso,
            endDate: null,
            notes: null,
            deletedAt: null,
          });
        }
        toast.success("Profile saved.");
        // The layout read "no profile yet" when this screen opened; read it
        // again, or the next screen would still ask for setup.
        await router.invalidate();
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
          <CardContent className="grid gap-3 pb-2 @sm:grid-cols-3">
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
                      onBlur={field.handleBlur}
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
                      onBlur={field.handleBlur}
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
                      yearsBack={CONFIG_YEARS_BACK}
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                      onBlur={field.handleBlur}
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
                  <LabelWithTooltip tooltip={GLOSSARY.entityType}>Entity type</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      onBlur={field.handleBlur}
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

      {/* "Restore a backup" on the set-up-first screens links here. */}
      <div id="restore" className="scroll-mt-16">
        <ImportCard variant="setup" onImported={() => navigate({ to: "/" })} />
      </div>
    </Page>
  );
}
