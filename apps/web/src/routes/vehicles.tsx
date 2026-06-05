import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { vehicleRepo } from "@fiscode/db";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/vehicles")({
  loader: async () => ({ vehicles: await vehicleRepo.list() }),
  component: VehiclesPage,
});

function VehiclesPage() {
  const { vehicles } = useLoaderData({ from: "/vehicles" });
  const router = useRouter();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mpg, setMpg] = useState("");

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!make.trim() || !model.trim()) return;
    await vehicleRepo.create({
      make: make.trim(),
      model: model.trim(),
      year: year ? Number(year) : null,
      mpg: mpg ? Number(mpg) : null,
      method: "standard_mileage",
      inServiceDate: null,
      notes: null,
      deletedAt: null,
    });
    setMake("");
    setModel("");
    setYear("");
    setMpg("");
    toast.success("Vehicle added.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await vehicleRepo.softDelete(id);
    router.invalidate();
  };

  return (
    <Page
      title="Vehicles"
      description="Vehicles used for business. MPG is informational only — the tax deduction uses business miles × IRS rate."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="vmake">Make</Label>
            <Input id="vmake" value={make} onChange={(e) => setMake(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vmodel">Model</Label>
            <Input id="vmodel" value={model} onChange={(e) => setModel(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vyear">Year</Label>
            <Input
              id="vyear"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vmpg">MPG</Label>
            <Input id="vmpg" type="number" value={mpg} onChange={(e) => setMpg(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit">Add</Button>
          </div>
        </form>
      </Card>

      <DataTable>
        <DataTable.Head>
          <DataTable.Row>
            <DataTable.HeaderCell>Make</DataTable.HeaderCell>
            <DataTable.HeaderCell>Model</DataTable.HeaderCell>
            <DataTable.HeaderCell>Year</DataTable.HeaderCell>
            <DataTable.HeaderCell>MPG</DataTable.HeaderCell>
            <DataTable.HeaderCell>Method</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {vehicles.length === 0 ? (
            <DataTable.Empty message="No vehicles yet." />
          ) : (
            vehicles.map((v) => (
              <DataTable.Row key={v.id}>
                <DataTable.Cell>{v.make}</DataTable.Cell>
                <DataTable.Cell>{v.model}</DataTable.Cell>
                <DataTable.Cell>{v.year ?? "—"}</DataTable.Cell>
                <DataTable.Cell>{v.mpg ?? "—"}</DataTable.Cell>
                <DataTable.Cell>{v.method}</DataTable.Cell>
                <DataTable.Cell align="right">
                  <Button variant="ghost" size="sm" onClick={() => remove(v.id)}>
                    Archive
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
