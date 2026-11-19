import { useState } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { FieldCheckbox } from "../components/forms/field-checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo, profileRepo, spouseRepo } from "@fiscode/db";
import {
  EntityPeriodError,
  cents,
  EntityOverlapError,
  canMoveEntityStart,
  ENTITY_TYPE_LABELS,
  FILING_STATUS_LABELS,
  QUARTERLY_METHOD_LABELS,
  labelFor,
  labelOptions,
} from "@fiscode/core";
import { formatDate } from "../lib/format-date";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { dependentsCount, leadDays, optionalMoneyAmountOrZero } from "../lib/field-schemas";
import { ConfirmDialog } from "@fiscode/ui/components/confirm-dialog";

import { Page } from "../components/page";
import { TSFormField } from "../components/forms/ts-form-field";
import {
  CONFIG_YEARS_BACK,
  DatePicker,
  dateToIso,
  isoToDate,
} from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { StateCombobox } from "../components/forms/state-combobox";
import { LabelWithTooltip } from "../components/forms/labeled";
import { InfoTooltip } from "../components/info-tooltip";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { EditEntityDialog } from "../components/edit-entity-dialog";
import {
  entityPeriodFieldError,
  periodErrorFor,
  type EntityPeriodFieldError,
} from "../lib/entity-period-error";
import { EditSpouseDialog } from "../components/edit-spouse-dialog";
import { GLOSSARY } from "../lib/tax-glossary";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { SectionTitle } from "../components/section-title";
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { recordLabel } from "../lib/record-label";

const FILING_OPTIONS = labelOptions(FILING_STATUS_LABELS);

const QUARTERLY_OPTIONS = labelOptions(QUARTERLY_METHOD_LABELS);

// S corp is listed and disabled: the estimate does not handle it yet.
const ENTITY_OPTIONS = labelOptions(ENTITY_TYPE_LABELS).map((o) =>
  o.value === "s_corp" ? { ...o, label: `${o.label} (coming soon)` } : o,
);

const profileSchema = z.object({
  filingStatus: z.enum(["single", "mfj", "mfs", "hoh"], {
    message: "Pick a filing status",
  }),
  state: z.string().min(2, "Pick a state").max(2, "Pick a state"),
  seStartDate: z.date({ message: "Pick a start date" }),
  // Dependents: non-negative integer. Blank input rejected; "0" accepted.
  dependents: dependentsCount,
  quarterlyMethod: z.enum(["annualized", "even"], {
    message: "Pick a quarterly method",
  }),
  // Prep lead days: must be ≥ 1 (otherwise no lead time at all).
  prepLeadDays: leadDays,
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
  wages: optionalMoneyAmountOrZero,
  fedWH: optionalMoneyAmountOrZero,
  stateWH: optionalMoneyAmountOrZero,
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
      <Page
        width="form"
        title="Profile"
        description="Filing status, residence, dependents, and preferences."
      >
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
  // Spouse income only enters a joint return. Read from the saved profile, so
  // the card follows what Save profile stored, not an unsaved pick.
  const filesJointly = profile.filingStatus === "mfj";

  const profileForm = useForm({
    defaultValues: {
      filingStatus: profile.filingStatus,
      state: profile.state,
      // `isoToDate`, not `new Date(iso)`: a date-only string parses as
      // midnight UTC, which is the previous day west of UTC.
      seStartDate: profile.seStartDate ? isoToDate(profile.seStartDate) : undefined,
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
      const newStart = dateToIso(value.seStartDate!);
      if (moveEntityStart && entityStartToMove(newStart) && !entityMoveBlocked(newStart)) {
        const moved = await entityRepo.moveFirstStart(newStart);
        if (moved.moved) {
          toast.success(
            `Profile updated. Your first entity period now starts ${formatDate(newStart)}.`,
          );
        } else if (moved.reason === "rejected") {
          toast.error(`Profile updated. The entity period was not moved: ${moved.error.message}`);
        } else {
          toast.success("Profile updated.");
        }
      } else {
        toast.success("Profile updated.");
      }
      router.invalidate();
    },
  });

  // The first entity period, when a new SE start would move its start: the
  // confirm dialog offers that move (on by default).
  const firstEntity = entities
    .filter((e) => e.deletedAt === null)
    .toSorted((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))[0];
  const entityStartToMove = (newStart: string) =>
    newStart !== profile.seStartDate &&
    firstEntity !== undefined &&
    firstEntity.startDate !== newStart;
  const [moveEntityStart, setMoveEntityStart] = useState(true);
  // Why the repo would refuse the move, checked before it is offered with
  // the repo's own rule (`canMoveEntityStart`); the repo stays the backstop.
  const entityMoveBlocked = (newStart: string): string | null => {
    if (!firstEntity) return null;
    const problem = canMoveEntityStart(entities, firstEntity, newStart);
    if (!problem) return null;
    if (problem instanceof EntityOverlapError) {
      return `Your first entity period stays as it is. ${problem.message}`;
    }
    return `Your first entity period ends ${formatDate(firstEntity.endDate!)}, before ${formatDate(newStart)}, so it stays as it is. Edit it under Entity periods if you need to.`;
  };

  // The new SE start when the dialog has something to say about the first
  // entity period (a checkbox, or why it stays).
  const offeredMove = (): string | undefined => {
    const v = profileForm.state.values.seStartDate;
    const newStart = v ? dateToIso(v) : undefined;
    return newStart && entityStartToMove(newStart) ? newStart : undefined;
  };

  // Set when the repo blocks an entity period: an overlap, or an end before the start.
  // Set when the repo blocks the dates; shown on the field it is about.
  const [entityError, setEntityError] = useState<EntityPeriodFieldError | null>(null);

  const entityForm = useForm({
    defaultValues: {
      type: "" as "" | "sole_prop" | "single_member_llc",
      startDate: undefined as Date | undefined,
      endDate: undefined as Date | undefined,
    },
    validators: { onSubmit: entitySchema as never },
    onSubmit: async ({ value, formApi }) => {
      setEntityError(null);
      try {
        await entityRepo.create({
          type: value.type as "sole_prop" | "single_member_llc",
          startDate: dateToIso(value.startDate!),
          endDate: value.endDate ? dateToIso(value.endDate) : null,
          notes: null,
          deletedAt: null,
        });
      } catch (err) {
        if (!(err instanceof EntityPeriodError)) throw err;
        // Taken with the saved periods: it lapses once one of them changes.
        setEntityError(entityPeriodFieldError(err, entities));
        return;
      }
      toast.success("Entity period added.");
      formApi.reset();
      router.invalidate();
    },
  });

  async function endEntityNow(id: string) {
    try {
      await entityRepo.update(id, { endDate: dateToIso(new Date()) });
    } catch (err) {
      if (!(err instanceof EntityPeriodError)) throw err;
      toast.error(err.message);
      return;
    }
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
      // Ticked by default every time the dialog opens.
      setMoveEntityStart(true);
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
        // A blank amount parses to null and is stored as $0.
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
    <Page
      width="form"
      title="Profile"
      description="Filing status, residence, dependents, and preferences."
    >
      <ConfirmDialog
        open={scopeConfirmOpen}
        onOpenChange={setScopeConfirmOpen}
        title="Save changes to scope-shifting fields?"
        description={`Changing your ${changedScopeFields().join(" and ")} retroactively recomputes the year. Rows dated outside the new window stop being counted; brackets and rates change with the new filing-status / state. ${
          offeredMove() ? "Your rows are unchanged." : "The underlying data is unchanged."
        }`}
        confirmLabel="Save"
        confirmVariant="destructive"
        onConfirm={() => void profileForm.handleSubmit()}
      >
        {(() => {
          const newStart = offeredMove();
          if (!newStart || !firstEntity) return null;
          const blocked = entityMoveBlocked(newStart);
          if (blocked) return <p className="text-sm">{blocked}</p>;
          return (
            <label className="flex items-start gap-2 text-sm">
              <FieldCheckbox checked={moveEntityStart} onCheckedChange={setMoveEntityStart} />
              <span>
                Also move your first entity period ({labelFor(ENTITY_TYPE_LABELS, firstEntity.type)}
                ) to start {formatDate(newStart)}, from {formatDate(firstEntity.startDate)}.
              </span>
            </label>
          );
        })()}
      </ConfirmDialog>

      <EnterToSubmitForm onSubmit={handleProfileSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Profile</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-4 pb-2 @md:grid-cols-2">
            <TSFormField form={profileForm} name="filingStatus" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.filingStatus}>Filing status</LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={FILING_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={profileForm} name="state" requirement="required">
              {(field) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <StateCombobox
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(code) => field.handleChange(code)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField form={profileForm} name="seStartDate" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.seStartDate}>
                    Self-employment start date
                  </LabelWithTooltip>
                  <FormControl>
                    <DatePicker
                      yearsBack={CONFIG_YEARS_BACK}
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
              form={profileForm}
              name="dependents"
              requirement="required"
              validators={{ onBlur: profileSchema.shape.dependents }}
            >
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.dependents}>Dependents</LabelWithTooltip>
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
            <TSFormField form={profileForm} name="quarterlyMethod" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.quarterlyMethodLabel}>
                    Quarterly method
                  </LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={QUARTERLY_OPTIONS}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={profileForm}
              name="prepLeadDays"
              requirement="required"
              validators={{ onBlur: profileSchema.shape.prepLeadDays }}
            >
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip={GLOSSARY.prepLeadDays}>
                    Prep lead days
                  </LabelWithTooltip>
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
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2 @md:col-span-2">
              <TSFormField form={profileForm} name="tracksRoth">
                {(field) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <FieldCheckbox
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v)}
                        onBlur={field.handleBlur}
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
                      <FieldCheckbox
                        checked={field.state.value}
                        onCheckedChange={(v) => field.handleChange(v)}
                        onBlur={field.handleBlur}
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
            <CardTitle>
              <SectionTitle>
                Entity periods
                <InfoTooltip text={GLOSSARY.entityType} />
              </SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {entities.map((e) => (
                <li key={e.id} className="flex items-center gap-3">
                  <span className="whitespace-nowrap">
                    {formatDate(e.startDate)} – {e.endDate ? formatDate(e.endDate) : "open"}
                  </span>
                  <span>{labelFor(ENTITY_TYPE_LABELS, e.type)}</span>
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
                        description={`This ${labelFor(ENTITY_TYPE_LABELS, e.type)} period (started ${formatDate(e.startDate)}) will close at today's date. You can edit the end date later from your data.`}
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
            <TSFormField
              form={entityForm}
              name="type"
              requirement="required"
              validators={{ onBlur: efs.type }}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
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
            <TSFormField
              form={entityForm}
              name="startDate"
              requirement="required"
              validators={{ onBlur: efs.startDate }}
              error={periodErrorFor(entityError, "startDate", entities)}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>Start</FormLabel>
                  <FormControl>
                    <DatePicker
                      yearsBack={CONFIG_YEARS_BACK}
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => {
                        // A new date is a new attempt; the old refusal no longer applies.
                        setEntityError(null);
                        field.handleChange(d);
                      }}
                    />
                  </FormControl>
                  <FormMessage role="alert" />
                </FormItem>
              )}
            </TSFormField>
            <TSFormField
              form={entityForm}
              name="endDate"
              requirement="optional"
              error={periodErrorFor(entityError, "endDate", entities)}
            >
              {(field) => (
                <FormItem>
                  <FormLabel>End</FormLabel>
                  <FormControl>
                    <DatePicker
                      yearsBack={CONFIG_YEARS_BACK}
                      value={field.state.value as Date | undefined}
                      onBlur={field.handleBlur}
                      onValueChange={(d) => {
                        setEntityError(null);
                        field.handleChange(d);
                      }}
                      disableFuture={false}
                    />
                  </FormControl>
                  <FormMessage role="alert" />
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
                <Button type="submit" variant="outline" disabled={!canSubmit || isSubmitting}>
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
            <CardTitle>
              <SectionTitle>
                Spouse income blocks
                <InfoTooltip text={GLOSSARY.spouseBlock} />
              </SectionTitle>
            </CardTitle>
          </CardHeader>
          {/* Rows first, then the form, as in the entity card. */}
          <CardContent>
            <ul className="space-y-1 text-sm">
              {spouses.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span>
                    {formatDate(s.startDate)} – {s.endDate ? formatDate(s.endDate) : "open"} · $
                    {(s.annualW2WagesCents / 100).toLocaleString()}
                  </span>
                  <div className="ms-auto inline-flex gap-1">
                    <EditSpouseDialog spouse={s} onSaved={() => router.invalidate()} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={async (e) => {
                        const refocus = focusAfterRemoval(e.currentTarget);
                        await softDeleteWithUndo({
                          repo: spouseRepo,
                          row: s,
                          message: "Spouse block deleted.",
                          onChange: () => router.invalidate(),
                        });
                        await router.invalidate();
                        refocus();
                      }}
                    >
                      Delete <span className="sr-only">{recordLabel.spouse(s)}</span>
                    </Button>
                  </div>
                </li>
              ))}
              {spouses.length === 0 ? (
                <li className="text-muted-foreground">No spouse blocks.</li>
              ) : null}
            </ul>
          </CardContent>
          {filesJointly ? (
            <CardContent
              // Two groups: the dates (half the row each), then the three
              // amounts (a third each).
              className="grid items-start gap-3 pb-2 @sm:grid-cols-6 @sm:[&>*]:col-span-3 @lg:[&>*]:col-span-2 @lg:[&>*:nth-child(-n+2)]:col-span-3"
            >
              <TSFormField
                form={spouseForm}
                name="startDate"
                requirement="required"
                validators={{ onBlur: sfs.startDate }}
              >
                {(field) => (
                  <FormItem>
                    <FormLabel>Start</FormLabel>
                    <FormControl>
                      <DatePicker
                        yearsBack={CONFIG_YEARS_BACK}
                        value={field.state.value as Date | undefined}
                        onBlur={field.handleBlur}
                        onValueChange={(d) => field.handleChange(d)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              </TSFormField>
              <TSFormField form={spouseForm} name="endDate" requirement="optional">
                {(field) => (
                  <FormItem>
                    <FormLabel>End</FormLabel>
                    <FormControl>
                      <DatePicker
                        yearsBack={CONFIG_YEARS_BACK}
                        value={field.state.value as Date | undefined}
                        onBlur={field.handleBlur}
                        onValueChange={(d) => field.handleChange(d)}
                        disableFuture={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              </TSFormField>
              <TSFormField
                form={spouseForm}
                name="wages"
                requirement="optional"
                validators={{ onBlur: sfs.wages }}
              >
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
              <TSFormField
                form={spouseForm}
                name="fedWH"
                requirement="optional"
                validators={{ onBlur: sfs.fedWH }}
              >
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
              <TSFormField
                form={spouseForm}
                name="stateWH"
                requirement="optional"
                validators={{ onBlur: sfs.stateWH }}
              >
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
          ) : (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Spouse income counts only on a joint return. To add it, set filing status to Married
                filing jointly above.
              </p>
            </CardContent>
          )}
          {filesJointly ? (
            <CardFooter className="justify-end">
              <spouseForm.Subscribe
                selector={(s) => ({
                  canSubmit: s.canSubmit,
                  isSubmitting: s.isSubmitting,
                })}
              >
                {({ canSubmit, isSubmitting }) => (
                  <Button type="submit" variant="outline" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Adding..." : "Add"}
                  </Button>
                )}
              </spouseForm.Subscribe>
            </CardFooter>
          ) : null}
        </Card>
      </EnterToSubmitForm>
    </Page>
  );
}
