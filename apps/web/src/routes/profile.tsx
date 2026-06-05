import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { entityRepo, profileRepo, spouseRepo } from "@fiscode/db";
import { useState } from "react";
import { toast } from "sonner";
import { cents, parseUSD } from "@fiscode/core";

import { Page } from "../components/page";

export const Route = createFileRoute("/profile")({
  loader: async () => ({
    profile: (await profileRepo.get())!,
    entities: await entityRepo.list(),
    spouses: await spouseRepo.list(),
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, entities, spouses } = useLoaderData({ from: "/profile" });
  const router = useRouter();
  const [filingStatus, setFilingStatus] = useState(profile.filingStatus);
  const [state, setState] = useState(profile.state);
  const [dependents, setDependents] = useState(String(profile.dependents));
  const [quarterlyMethod, setQuarterlyMethod] = useState(profile.quarterlyMethod);
  const [prepLeadDays, setPrepLeadDays] = useState(String(profile.prepLeadDays));
  const [tracksRoth, setTracksRoth] = useState(profile.tracksRoth);
  const [usesRetirement, setUsesRetirement] = useState(profile.usesRetirement);

  const saveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await profileRepo.upsert({
      filingStatus,
      state,
      seStartDate: profile.seStartDate,
      dependents: Number(dependents) || 0,
      tracksRoth,
      usesRetirement,
      quarterlyMethod,
      prepLeadDays: Number(prepLeadDays) || 14,
    });
    toast.success("Profile updated.");
    router.invalidate();
  };

  // Spouse block.
  const [spouseStart, setSpouseStart] = useState("");
  const [spouseEnd, setSpouseEnd] = useState("");
  const [spouseWages, setSpouseWages] = useState("");
  const [spouseFedWH, setSpouseFedWH] = useState("");
  const [spouseStateWH, setSpouseStateWH] = useState("");

  const addSpouse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!spouseStart) return;
    await spouseRepo.create({
      startDate: spouseStart,
      endDate: spouseEnd || null,
      annualW2WagesCents: parseUSD(spouseWages) ?? cents(0),
      annualFederalWithholdingCents: parseUSD(spouseFedWH) ?? cents(0),
      annualStateWithholdingCents: parseUSD(spouseStateWH) ?? cents(0),
      notes: null,
      deletedAt: null,
    });
    setSpouseStart("");
    setSpouseEnd("");
    setSpouseWages("");
    setSpouseFedWH("");
    setSpouseStateWH("");
    toast.success("Spouse block added.");
    router.invalidate();
  };

  return (
    <Page title="Profile" description="Filing status, residence, dependents, and preferences.">
      <Card className="p-4">
        <form onSubmit={saveProfile} className="grid gap-4 @md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pfs">Filing status</Label>
            <select
              id="pfs"
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="single">Single</option>
              <option value="mfj">Married filing jointly</option>
              <option value="mfs">Married filing separately</option>
              <option value="hoh">Head of household</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pst">State</Label>
            <Input
              id="pst"
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              maxLength={2}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pdep">Dependents</Label>
            <Input
              id="pdep"
              type="number"
              min={0}
              value={dependents}
              onChange={(e) => setDependents(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pqm">Quarterly method</Label>
            <select
              id="pqm"
              value={quarterlyMethod}
              onChange={(e) => setQuarterlyMethod(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="annualized">Annualized installment</option>
              <option value="even">Even split (annual / 4)</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pld">Prep lead days</Label>
            <Input
              id="pld"
              type="number"
              min={1}
              value={prepLeadDays}
              onChange={(e) => setPrepLeadDays(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tracksRoth}
                onChange={(e) => setTracksRoth(e.target.checked)}
              />
              Track Roth IRA (informational)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={usesRetirement}
                onChange={(e) => setUsesRetirement(e.target.checked)}
              />
              Uses SEP / Solo 401(k)
            </label>
          </div>
          <div className="@md:col-span-2">
            <Button type="submit">Save profile</Button>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">Entities</h2>
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
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Spouse income blocks
        </h2>
        <form
          onSubmit={addSpouse}
          className="mb-4 grid gap-3 @md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]"
        >
          <div className="grid gap-1">
            <Label htmlFor="ss">Start</Label>
            <Input
              id="ss"
              type="date"
              value={spouseStart}
              onChange={(e) => setSpouseStart(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="se">End</Label>
            <Input
              id="se"
              type="date"
              value={spouseEnd}
              onChange={(e) => setSpouseEnd(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="sw">Annual W-2 wages</Label>
            <Input
              id="sw"
              value={spouseWages}
              onChange={(e) => setSpouseWages(e.target.value)}
              placeholder="$0.00"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="sfw">Fed withholding</Label>
            <Input
              id="sfw"
              value={spouseFedWH}
              onChange={(e) => setSpouseFedWH(e.target.value)}
              placeholder="$0.00"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ssw">State withholding</Label>
            <Input
              id="ssw"
              value={spouseStateWH}
              onChange={(e) => setSpouseStateWH(e.target.value)}
              placeholder="$0.00"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit">Add</Button>
          </div>
        </form>
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
      </Card>
    </Page>
  );
}
