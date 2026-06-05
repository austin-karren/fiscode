import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { clientRepo } from "@fiscode/db";
import { cents, formatUSD, parseUSD } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/clients")({
  loader: async () => ({ clients: await clientRepo.list() }),
  component: ClientsPage,
});

function ClientsPage() {
  const { clients } = useLoaderData({ from: "/clients" });
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [defaultRate, setDefaultRate] = useState("");

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    await clientRepo.create({
      name: name.trim(),
      type: type.trim() || null,
      notes: null,
      defaultRateCents: defaultRate ? (parseUSD(defaultRate) ?? null) : null,
      defaultCommissionRate: null,
      deletedAt: null,
    });
    setName("");
    setType("");
    setDefaultRate("");
    toast.success("Client added.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await clientRepo.softDelete(id);
    toast.success("Client archived.");
    router.invalidate();
  };

  return (
    <Page title="Clients" description="Companies you do recurring or one-off work for.">
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[2fr_1fr_1fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="cname">Name</Label>
            <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ctype">Type</Label>
            <Input
              id="ctype"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="recurring, consulting"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="crate">Default rate</Label>
            <Input
              id="crate"
              value={defaultRate}
              onChange={(e) => setDefaultRate(e.target.value)}
              placeholder="$0.00"
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
            <DataTable.HeaderCell>Name</DataTable.HeaderCell>
            <DataTable.HeaderCell>Type</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Default rate</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {clients.length === 0 ? (
            <DataTable.Empty message="No clients yet." />
          ) : (
            clients.map((c) => (
              <DataTable.Row key={c.id}>
                <DataTable.Cell>{c.name}</DataTable.Cell>
                <DataTable.Cell>{c.type ?? "—"}</DataTable.Cell>
                <DataTable.Cell align="right">
                  {c.defaultRateCents !== null ? formatUSD(cents(c.defaultRateCents)) : "—"}
                </DataTable.Cell>
                <DataTable.Cell align="right">
                  <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
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
