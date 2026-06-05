import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { entityRepo, profileRepo } from "@fiscode/db";
import { todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";

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
  const [filingStatus, setFilingStatus] = useState("mfj");
  const [state, setState] = useState("UT");
  const [seStartDate, setSeStartDate] = useState<string>(todayIso());
  const [entityType, setEntityType] = useState("sole_prop");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await profileRepo.upsert({
        filingStatus,
        state,
        seStartDate,
        dependents: 0,
        tracksRoth: false,
        usesRetirement: false,
        quarterlyMethod: "annualized",
        prepLeadDays: 14,
      });
      await entityRepo.create({
        type: entityType,
        startDate: seStartDate,
        endDate: null,
        notes: null,
        deletedAt: null,
      });
      toast.success("Profile saved.");
      navigate({ to: "/" });
    } catch (err) {
      console.error(err);
      toast.error("Could not save profile.");
      setBusy(false);
    }
  };

  return (
    <Page
      title="Welcome to fiscode"
      description="Just the minimum to get started. Everything else is optional."
    >
      <Card className="p-6">
        <form onSubmit={submit} className="grid max-w-xl gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="filing">Filing status</Label>
            <select
              id="filing"
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
            <Label htmlFor="state">State of residence</Label>
            <Input
              id="state"
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              maxLength={2}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ssd">Self-employment start date</Label>
            <Input
              id="ssd"
              type="date"
              value={seStartDate}
              onChange={(e) => setSeStartDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="entity">Entity type</Label>
            <select
              id="entity"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="sole_prop">Sole proprietor</option>
              <option value="single_member_llc">Single-member LLC</option>
              <option value="s_corp" disabled>
                S corp (coming soon)
              </option>
            </select>
          </div>
          <div className="mt-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : "Save and continue"}
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
