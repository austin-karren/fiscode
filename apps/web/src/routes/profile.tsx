import { useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Checkbox } from "@fiscode/ui/components/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo, profileRepo, spouseRepo } from "@fiscode/db";
import {
  cents,
  nonNegativeIntegerString,
  optionalUsdString,
  positiveIntegerString,
} from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@fiscode/ui/components/confirm-dialog";

import { Page } from "../components/page";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { StateCombobox } from "../components/forms/state-combobox";
import { LabelWithTooltip } from "../components/forms/labeled";
import { InfoTooltip } from "../components/info-tooltip";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditEntityDialog } from "../components/edit-entity-dialog";
import { EditSpouseDialog } from "../components/edit-spouse-dialog";
import { GLOSSARY } from "../lib/tax-glossary";

const FILING_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married filing jointly" },
  { value: "mfs", label: "Married filing separately" },
  { value: "hoh", label: "Head of household" },
];

const QUARTERLY_OPTIONS = [
  { value: "annualized", label: "Annualized installment" },
  { value: "even", label: "Even split (annual / 4)" },
];

const ENTITY_OPTIONS = [
  { value: "sole_prop", label: "Sole proprietor" },
  { value: "single_member_llc", label: "Single-member LLC" },
  { value: "s_corp", label: "S corp (coming soon)" },
];

const profileSchema = z.object({
  filingStatus: z.enum(["single", "mfj", "mfs", "hoh"], {
    message: "Pick a filing status",
  }),
  state: z.string().min(2, "Pick a state").max(2, "Pick a state"),
  seStartDate: z.date({ message: "Pick a start date" }),
  // Dependents: non-negative integer. Blank input rejected; "0" accepted.
  dependents: nonNegativeIntegerString,
  quarterlyMethod: z.enum(["annualized", "even"], {
    message: "Pick a quarterly method",
  }),
  // Prep lead days: must be ≥ 1 (otherwise no lead time at all).
  prepLeadDays: positiveIntegerString,
  tracksRoth: z.boolean(),
  usesRetirement: z.boolean(),
});

const entitySchema = z.object({
  type: z.enum(["sole_prop", "single_member_llc"], { message: "Pick an entity type" }),
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
});
const efs = entitySchema.shape;

const spouseSchema = z.object({
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
  // Spouse $ inputs: blank → 0; otherwise must parse as USD. Catches typos
  // that previously silently became $0 of withholding.
  wages: optionalUsdString,
  fedWH: optionalUsdString,
  stateWH: optionalUsdString,
});
const sfs = spouseSchema.shape;

export const Route = createFileRoute("/profile")({
  // No beforeLoad redirect — let the route load, then conditionally render
  // SetupRequiredEmpty if profile is missing. Direct visits and back-button
  // nav both work; nothing bounces you out.
  loader: async () => ({
    profile: await profileRepo.get(),
    entities: await entityRepo.list(),
    spouses: await spouseRepo.list(),
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, entities, spouses } = useLoaderData({ from: "/profile" });
  if (!profile) {
    return (
      <Page title="Profile" description="Filing status, residence, dependents, and preferences.">
        <SetupRequiredEmpty />
      </Page>
    );
  }
  return <ProfileFormPanel profile={profile} entities={entities} spouses={spouses} />;
}

function ProfileFormPanel({
  profile,
  entities,
  spouses,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof profileRepo.get>>>;
  entities: Awaited<ReturnType<typeof entityRepo.list>>;
  spouses: Awaited<ReturnType<typeof spouseRepo.list>>;
}) {
  const router = useRouter();

  const profileForm = useForm({
    defaultValues: {
      filingStatus: profile.filingStatus,
      state: profile.state,
      seStartDate: profile.seStartDate
        ? new Date(profile.seStartDate)
        : (undefined as Date | undefined),
      dependents: String(profile.dependents),
      quarterlyMethod: profile.quarterlyMethod,
      prepLeadDays: String(profile.prepLeadDays),
      tracksRoth: profile.tracksRoth,
      usesRetirement: profile.usesRetirement,
    },
    // Cast because zod's optional Date doesn't line up with TanStack Form's
    // exactOptional handling.
    validators: { onSubmit: profileSchema as never },
    onSubmit: async ({ value }) => {
      // Re-parse through profileSchema to get typed numerics
      // (dependents: number, prepLeadDays: number). Validation already ran
      // via the form-level onSubmit validator; this is just the type narrow.
      const parsed = profileSchema.parse(value);
      await profileRepo.upsert({
        filingStatus: parsed.filingStatus,
        state: parsed.state,
        seStartDate: dateToIso(value.seStartDate!),
        dependents: parsed.dependents,
        tracksRoth: parsed.tracksRoth,
        usesRetirement: parsed.usesRetirement,
        quarterlyMethod: parsed.quarterlyMethod,
        prepLeadDays: parsed.prepLeadDays,
      });
      toast.success("Profile updated.");
      router.invalidate();
    },
  });

  const entityForm = useForm({
    defaultValues: {
      type: "" as "" | "sole_prop" | "single_member_llc",
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
    },
    validators: { onSubmit: entitySchema as never },
    onSubmit: async ({ value, formApi }) => {
      await entityRepo.create({
        type: value.type as "sole_prop" | "single_member_llc",
        startDate: dateToIso(value.startDate!),
        endDate: value.endDate ? dateToIso(value.endDate) : null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Entity period added.");
      formApi.reset();
      router.invalidate();
    },
  });

  async function endEntityNow(id: string) {
    await entityRepo.update(id, { endDate: dateToIso(new Date()) });
    toast.success("Entity period ended.");
    router.invalidate();
  }

  // Scope-shifting fields rewrite what counts / how it's taxed for the
  // whole year. Gate them behind a confirm dialog. The non-scope fields
  // (dependents, prepLeadDays, tracksRoth, usesRetirement) save without
  // confirmation.
  const [scopeConfirmOpen, setScopeConfirmOpen] = useState(false);
  const changedScopeFields = (): string[] => {
    const v = profileForm.state.values;
    const changed: string[] = [];
    if (v.seStartDate && dateToIso(v.seStartDate) !== profile.seStartDate) {
      changed.push("self-employment start date");
    }
    if (v.filingStatus !== profile.filingStatus) changed.push("filing status");
    if (v.state !== profile.state) changed.push("state");
    return changed;
  };
  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (changedScopeFields().length > 0) {
      setScopeConfirmOpen(true);
      return;
    }
    void profileForm.handleSubmit();
  };

  const spouseForm = useForm({
    defaultValues: {
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
      wages: "",
      fedWH: "",
      stateWH: "",
    },
    // Cast because spouseSchema's optional endDate (Date | undefined) doesn't
    // line up exactly with TanStack Form's stricter exactOptional handling.
    validators: { onSubmit: spouseSchema as never },
    onSubmit: async ({ value, formApi }) => {
      const parsed = spouseSchema.parse(value);
      await spouseRepo.create({
        startDate: dateToIso(value.startDate!),
        endDate: value.endDate ? dateToIso(value.endDate) : null,
        // optionalUsdString returns number | null; null = blank input → $0.
        annualW2WagesCents: parsed.wages ?? cents(0),
        annualFederalWithholdingCents: parsed.fedWH ?? cents(0),
        annualStateWithholdingCents: parsed.stateWH ?? cents(0),
        notes: null,
        deletedAt: null,
      });
      toast.success("Spouse block added.");
      formApi.reset();
      router.invalidate();
    },
  });

  return (
    <Page title="Profile" description="Filing status, residence, dependents, and preferences.">
      <ConfirmDialog
        open={scopeConfirmOpen}
        onOpenChange={setScopeConfirmOpen}
        title="Save changes to scope-shifting fields?"
        description={`Changing your ${changedScopeFields().join(" and ")} retroactively recomputes the year. Rows dated outside the new window stop being counted; brackets and rates change with the new filing-status / state. The underlying data is unchanged.`}
        confirmLabel="Save"
        confirmVariant="destructive"
        onConfirm={() => void profileForm.handleSubmit()}
      />

      <EnterToSubmitForm onSubmit={handleProfileSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-4 pb-2 @md:grid-cols-2">
            <TSFormField form={profileForm} name="filingStatus">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.filingStatus}>Filing status</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      items={FILING_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={profileForm} name="state">
              {(field) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
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
            <TSFormField form={profileForm} name="seStartDate">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.seStartDate}>
                    Self-employment start date
                  </LabelWithTooltip>
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
            <TSFormField form={profileForm} name="dependents">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.dependents}>Dependents</LabelWithTooltip>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={profileForm} name="quarterlyMethod">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.quarterlyMethodLabel}>
                    Quarterly method
                  </LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v)}
                      items={QUARTERLY_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={profileForm} name="prepLeadDays">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.prepLeadDays}>
                    Prep lead days
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
            <div className="flex items-end gap-4">
              <TSFormField form={profileForm} name="tracksRoth">
                {(field) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v === true)}
                      />
                    </FormControl>
                    <LabelWithTooltip tooltip={GLOSSARY.tracksRoth} className="text-sm font-normal">
                      Track Roth IRA (informational)
                    </LabelWithTooltip>
                  </FormItem>
                )}
              </TSFormField>
              <TSFormField form={profileForm} name="usesRetirement">
                {(field) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v === true)}
                      />
                    </FormControl>
                    <LabelWithTooltip
                      tooltip={GLOSSARY.usesRetirement}
                      className="text-sm font-normal"
                    >
                      Uses SEP / Solo 401(k)
                    </LabelWithTooltip>
                  </FormItem>
                )}
              </TSFormField>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <profileForm.Subscribe
              selector={(s) => ({
                canSubmit: s.canSubmit,
                isSubmitting: s.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save profile"}
                </Button>
              )}
            </profileForm.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void entityForm.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5 text-sm font-medium uppercase text-muted-foreground">
              Entity periods
              <InfoTooltip text={GLOSSARY.entityType} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {entities.map((e) => (
                <li key={e.id} className="flex items-center gap-3">
                  <span className="font-mono">
                    {e.startDate} – {e.endDate ?? "open"}
                  </span>
                  <span>{e.type}</span>
                  <div className="ms-auto inline-flex gap-1">
                    <EditEntityDialog entity={e} onSaved={() => router.invalidate()} />
                    {e.endDate ? null : (
                      <ConfirmDialog
                        trigger={
                          <Button type="button" variant="ghost" size="sm">
                            End today
                          </Button>
                        }
                        title="End this entity period today?"
                        description={`This ${e.type} period (started ${e.startDate}) will close at today's date. You can edit the end date later from your data.`}
                        confirmLabel="End it"
                        confirmVariant="destructive"
                        onConfirm={() => void endEntityNow(e.id)}
                      />
                    )}
                  </div>
                </li>
              ))}
              {entities.length === 0 ? (
                <li className="text-muted-foreground">No entity records.</li>
              ) : null}
            </ul>
          </CardContent>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-3">
            <TSFormField form={entityForm} name="type" validators={{ onBlur: efs.type }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onValueChange={(v) =>
                        field.handleChange(v as "" | "sole_prop" | "single_member_llc")
                      }
                      items={ENTITY_OPTIONS}
                      disabledValues={["s_corp"]}
                      placeholder="Pick a type…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={entityForm} name="startDate" validators={{ onBlur: efs.startDate }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Start</FormLabel>
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
            <TSFormField form={entityForm} name="endDate">
              {(field) => (
                <FormItem>
                  <FormLabel>End (optional)</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          </CardContent>
          <CardFooter className="justify-end">
            <entityForm.Subscribe
              selector={(s) => ({
                canSubmit: s.canSubmit,
                isSubmitting: s.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add entity period"}
                </Button>
              )}
            </entityForm.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void spouseForm.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5 text-sm font-medium uppercase text-muted-foreground">
              Spouse income blocks
              <InfoTooltip text={GLOSSARY.spouseBlock} />
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
            <TSFormField form={spouseForm} name="startDate" validators={{ onBlur: sfs.startDate }}>
              {(field) => (
                <FormItem>
                  <FormLabel>Start</FormLabel>
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
            <TSFormField form={spouseForm} name="endDate">
              {(field) => (
                <FormItem>
                  <FormLabel>End</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.state.value as Date | undefined}
                      onValueChange={(d) => field.handleChange(d)}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={spouseForm} name="wages">
              {(field) => (
                <FormItem>
                  <FormLabel>Annual W-2 wages</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="$0.00"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={spouseForm} name="fedWH">
              {(field) => (
                <FormItem>
                  <FormLabel>Fed withholding</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="$0.00"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={spouseForm} name="stateWH">
              {(field) => (
                <FormItem>
                  <FormLabel>State withholding</FormLabel>
                  <FormControl>
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="$0.00"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          </CardContent>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {spouses.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="font-mono">
                    {s.startDate} – {s.endDate ?? "open"} · $
                    {(s.annualW2WagesCents / 100).toLocaleString()}
                  </span>
                  <div className="ms-auto inline-flex gap-1">
                    <EditSpouseDialog spouse={s} onSaved={() => router.invalidate()} />
                  </div>
                </li>
              ))}
              {spouses.length === 0 ? (
                <li className="text-muted-foreground">No spouse blocks.</li>
              ) : null}
            </ul>
          </CardContent>
          <CardFooter className="justify-end">
            <spouseForm.Subscribe
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
            </spouseForm.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>
    </Page>
  );
}
