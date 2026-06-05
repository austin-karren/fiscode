import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { clientRepo, incomeRepo } from "@fiscode/db";
import { cents, formatUSD, parseUSD, todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

export const Route = createFileRoute("/income")({
  loader: async () => ({
    income: await incomeRepo.list(),
    clients: await clientRepo.list(),
  }),
  component: IncomePage,
});

function IncomePage() {
  const { income, clients } = useLoaderData({ from: "/income" });
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIso());
  const [amount, setAmount] = useState("");
  const [clientId, setClientId] = useState("");
  const [kind, setKind] = useState("recurring");
  const [description, setDescription] = useState("");

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsedAmount = parseUSD(amount);
    if (parsedAmount === undefined) {
      toast.error("Enter a valid amount.");
      return;
    }
    await incomeRepo.create({
      date,
      amountCents: parsedAmount,
      clientId: clientId || null,
      sourceType: "1099",
      kind,
      description: description || null,
      notes: null,
      deletedAt: null,
    });
    setAmount("");
    setDescription("");
    toast.success("Income entry added.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await incomeRepo.softDelete(id);
    router.invalidate();
  };

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "—") : "—";

  return (
    <Page
      title="Income"
      description="All 1099 income entries. Add bonuses and one-offs the same way as recurring."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1fr_1fr_2fr_auto]">
          <div className="grid gap-1">
            <Label htmlFor="idate">Date</Label>
            <Input
              id="idate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="iamt">Amount</Label>
            <Input
              id="iamt"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="$0.00"
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="iclient">Client</Label>
            <select
              id="iclient"
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
            <Label htmlFor="ikind">Kind</Label>
            <select
              id="ikind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm h-8"
            >
              <option value="recurring">Recurring</option>
              <option value="bonus">Bonus</option>
              <option value="consulting">Consulting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="idesc">Description</Label>
            <Input
              id="idesc"
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
            <DataTable.HeaderCell>Kind</DataTable.HeaderCell>
            <DataTable.HeaderCell>Description</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {income.length === 0 ? (
            <DataTable.Empty message="No income entries yet." />
          ) : (
            income
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((i) => (
                <DataTable.Row key={i.id}>
                  <DataTable.Cell>
                    <span className="font-mono">{i.date}</span>
                  </DataTable.Cell>
                  <DataTable.Cell>{clientName(i.clientId)}</DataTable.Cell>
                  <DataTable.Cell>{i.kind}</DataTable.Cell>
                  <DataTable.Cell>{i.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatUSD(cents(i.amountCents))}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(i.id)}>
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
