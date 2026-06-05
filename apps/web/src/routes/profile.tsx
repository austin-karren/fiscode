import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Checkbox } from "@fiscode/ui/components/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { entityRepo, profileRepo, spouseRepo } from "@fiscode/db";
import { cents, parseUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { Page } from "../components/page";
import { TSFormField } from "../components/forms/ts-form-field";
import { DatePicker, dateToIso } from "../components/forms/date-picker";
import { SelectWithLabels } from "../components/forms/select-with-labels";
import { LabelWithTooltip } from "../components/forms/labeled";
import { InfoTooltip } from "../components/info-tooltip";
import { SetupRequiredEmpty } from "../components/empty-states/setup-required";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
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

const profileSchema = z.object({
  filingStatus: z.enum(["single", "mfj", "mfs", "hoh"]),
  state: z.string().min(2).max(2),
  dependents: z.string(),
  quarterlyMethod: z.enum(["annualized", "even"]),
  prepLeadDays: z.string(),
  tracksRoth: z.boolean(),
  usesRetirement: z.boolean(),
});

const spouseSchema = z.object({
  startDate: z.date({ message: "Pick a start date" }),
  endDate: z.date().optional(),
  wages: z.string(),
  fedWH: z.string(),
  stateWH: z.string(),
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
      dependents: String(profile.dependents),
      quarterlyMethod: profile.quarterlyMethod,
      prepLeadDays: String(profile.prepLeadDays),
      tracksRoth: profile.tracksRoth,
      usesRetirement: profile.usesRetirement,
    },
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      await profileRepo.upsert({
        filingStatus: value.filingStatus,
        state: value.state,
        seStartDate: profile.seStartDate,
        dependents: Number(value.dependents) || 0,
        tracksRoth: value.tracksRoth,
        usesRetirement: value.usesRetirement,
        quarterlyMethod: value.quarterlyMethod,
        prepLeadDays: Number(value.prepLeadDays) || 14,
      });
      toast.success("Profile updated.");
      router.invalidate();
    },
  });

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
      await spouseRepo.create({
        startDate: dateToIso(value.startDate!),
        endDate: value.endDate ? dateToIso(value.endDate) : null,
        annualW2WagesCents: parseUSD(value.wages) ?? cents(0),
        annualFederalWithholdingCents: parseUSD(value.fedWH) ?? cents(0),
        annualStateWithholdingCents: parseUSD(value.stateWH) ?? cents(0),
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
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void profileForm.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pb-2 @md:grid-cols-2">
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
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                      onBlur={field.handleBlur}
                      maxLength={2}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Entities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {entities.map((e) => (
              <li key={e.id} className="font-mono">
                {e.startDate} – {e.endDate ?? "open"} · <span className="font-sans">{e.type}</span>
              </li>
            ))}
            {entities.length === 0 ? (
              <li className="text-muted-foreground">No entity records.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>

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
          <CardContent className="grid gap-3 pb-2 @sm:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-[1fr_1fr_1fr_1fr_1fr] @xl:items-end">
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
                <li key={s.id} className="font-mono">
                  {s.startDate} – {s.endDate ?? "open"} · $
                  {(s.annualW2WagesCents / 100).toLocaleString()}
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
