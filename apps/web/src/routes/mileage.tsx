import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { mileageRepo, vehicleRepo } from "@fiscode/db";
import { todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/mileage")({
  loader: async () => ({
    mileage: await mileageRepo.list(),
    vehicles: await vehicleRepo.list(),
  }),
  component: MileagePage,
});

function MileagePage() {
  const { mileage, vehicles } = useLoaderData({ from: "/mileage" });
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIso());
  const [miles, setMiles] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [purpose, setPurpose] = useState("");

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(miles);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter business miles.");
      return;
    }
    await mileageRepo.create({
      date,
      vehicleId: vehicleId || null,
      businessMiles: Math.round(n),
      purpose: purpose || null,
      notes: null,
      deletedAt: null,
    });
    setMiles("");
    setPurpose("");
    toast.success("Mileage logged.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await mileageRepo.softDelete(id);
    router.invalidate();
  };

  const vehicleName = (id: string | null) => {
    if (!id) return "—";
    const v = vehicles.find((vv) => vv.id === id);
    return v ? `${v.year ?? ""} ${v.make} ${v.model}`.trim() : "—";
  };

  return (
    <Page
      title="Mileage"
      description="Business miles. Standard mileage method is applied automatically using the year's IRS rate."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1.5fr_2fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="mdate">Date</Label>
            <Input
              id="mdate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mmiles">Business miles</Label>
            <Input
              id="mmiles"
              type="number"
              min={1}
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mveh">Vehicle</Label>
            <select
              id="mveh"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm h-8"
            >
              <option value="">—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mpurp">Purpose</Label>
            <Input id="mpurp" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit">Add</Button>
          </div>
        </form>
      </Card>

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
          {mileage.length === 0 ? (
            <DataTable.Empty message="No mileage logged yet." />
          ) : (
            mileage
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((m) => (
                <DataTable.Row key={m.id}>
                  <DataTable.Cell>
                    <span className="font-mono">{m.date}</span>
                  </DataTable.Cell>
                  <DataTable.Cell>{vehicleName(m.vehicleId)}</DataTable.Cell>
                  <DataTable.Cell>{m.purpose ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{m.businessMiles}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>
                      Delete
                    </Button>
                  </DataTable.Cell>
                </DataTable.Row>
              ))
          )}
        </DataTable.Body>
      </DataTable>
    </Page>
  );
}
