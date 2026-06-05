import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { clientRepo, timeRepo } from "@fiscode/db";
import { todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/time")({
  loader: async () => ({
    entries: await timeRepo.list(),
    clients: await clientRepo.list(),
  }),
  component: TimePage,
});

const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};

function TimePage() {
  const { entries, clients } = useLoaderData({ from: "/time" });
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIso());
  const [hours, setHours] = useState("");
  const [clientId, setClientId] = useState("");
  const [description, setDescription] = useState("");

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      toast.error("Enter hours worked.");
      return;
    }
    await timeRepo.create({
      date,
      clientId: clientId || null,
      minutes: Math.round(h * 60),
      description: description || null,
      notes: null,
      deletedAt: null,
    });
    setHours("");
    setDescription("");
    toast.success("Time entry added.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await timeRepo.softDelete(id);
    router.invalidate();
  };

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "—") : "—";

  return (
    <Page
      title="Time"
      description="Tracked for your own visibility. Time does not feed the tax estimate — income entries do."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1.5fr_2fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="tdate">Date</Label>
            <Input
              id="tdate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="thrs">Hours</Label>
            <Input
              id="thrs"
              type="number"
              step="0.25"
              min="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tclient">Client</Label>
            <select
              id="tclient"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm h-8"
            >
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tdesc">Description</Label>
            <Input
              id="tdesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
            <DataTable.HeaderCell>Client</DataTable.HeaderCell>
            <DataTable.HeaderCell>Description</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Time</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {entries.length === 0 ? (
            <DataTable.Empty message="No time entries yet." />
          ) : (
            entries
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((t) => (
                <DataTable.Row key={t.id}>
                  <DataTable.Cell>
                    <span className="font-mono">{t.date}</span>
                  </DataTable.Cell>
                  <DataTable.Cell>{clientName(t.clientId)}</DataTable.Cell>
                  <DataTable.Cell>{t.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatMinutes(t.minutes)}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(t.id)}>
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
