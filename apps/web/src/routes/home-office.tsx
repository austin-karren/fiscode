import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { homeOfficeRepo } from "@fiscode/db";
import { todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/home-office")({
  loader: async () => ({ rows: await homeOfficeRepo.list() }),
  component: HomeOfficePage,
});

function HomeOfficePage() {
  const { rows } = useLoaderData({ from: "/home-office" });
  const router = useRouter();
  const [startDate, setStartDate] = useState<string>(todayIso());
  const [officeSqft, setOfficeSqft] = useState("");
  const [homeSqft, setHomeSqft] = useState("");
  const [method, setMethod] = useState("simplified");
  const [ack, setAck] = useState(false);

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ack) {
      toast.error("Acknowledge regular & exclusive use to proceed.");
      return;
    }
    await homeOfficeRepo.create({
      startDate,
      endDate: null,
      method,
      officeSqft: officeSqft ? Number(officeSqft) : null,
      homeSqft: homeSqft ? Number(homeSqft) : null,
      monthlyRentMortgageCents: null,
      monthlyUtilitiesCents: null,
      monthlyInsuranceCents: null,
      regularExclusiveAck: ack,
      notes: null,
      deletedAt: null,
    });
    setOfficeSqft("");
    setHomeSqft("");
    setAck(false);
    toast.success("Home office config saved.");
    router.invalidate();
  };

  return (
    <Page
      title="Home office"
      description="Each dated config applies until the next one starts. Simplified method: $5/sqft up to 300 sqft (max $1,500/yr)."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="hstart">Start date</Label>
            <Input
              id="hstart"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="hmethod">Method</Label>
            <select
              id="hmethod"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm h-8"
            >
              <option value="simplified">Simplified</option>
              <option value="actual">Actual (advanced)</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="hofc">Office sqft</Label>
            <Input
              id="hofc"
              type="number"
              value={officeSqft}
              onChange={(e) => setOfficeSqft(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="hhome">Home sqft</Label>
            <Input
              id="hhome"
              type="number"
              value={homeSqft}
              onChange={(e) => setHomeSqft(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit">Save</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground @md:col-span-5">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I acknowledge the home office is used regularly and exclusively for business.
          </label>
        </form>
      </Card>

      <DataTable>
        <DataTable.Head>
          <DataTable.Row>
            <DataTable.HeaderCell>Start</DataTable.HeaderCell>
            <DataTable.HeaderCell>End</DataTable.HeaderCell>
            <DataTable.HeaderCell>Method</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Office sqft</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Home sqft</DataTable.HeaderCell>
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {rows.length === 0 ? (
            <DataTable.Empty message="No home office config yet." />
          ) : (
            rows.map((r) => (
              <DataTable.Row key={r.id}>
                <DataTable.Cell>
                  <span className="font-mono">{r.startDate}</span>
                </DataTable.Cell>
                <DataTable.Cell>
                  <span className="font-mono">{r.endDate ?? "—"}</span>
                </DataTable.Cell>
                <DataTable.Cell>{r.method}</DataTable.Cell>
                <DataTable.Cell align="right">{r.officeSqft ?? "—"}</DataTable.Cell>
                <DataTable.Cell align="right">{r.homeSqft ?? "—"}</DataTable.Cell>
              </DataTable.Row>
            ))
          )}
        </DataTable.Body>
      </DataTable>
    </Page>
  );
}
