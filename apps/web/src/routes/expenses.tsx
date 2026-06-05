import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Input } from "@fiscode/ui/components/input";
import { Label } from "@fiscode/ui/components/label";
import { Card } from "@fiscode/ui/components/card";
import { expenseRepo } from "@fiscode/db";
import { cents, formatUSD, parseUSD, todayIso } from "@fiscode/core";
import { useState } from "react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";

const CATEGORIES = [
  ["health_insurance", "Self-employed health insurance"],
  ["phone_internet", "Phone / internet"],
  ["software_subs", "Software & subscriptions"],
  ["professional_services", "Professional services"],
  ["meals", "Business meals (50%)"],
  ["equipment", "Equipment (§179 / bonus)"],
  ["home_office", "Home office"],
  ["vehicle", "Vehicle"],
  ["supplies", "Supplies"],
  ["travel", "Travel"],
  ["advertising", "Advertising"],
  ["other", "Other"],
] as const;

const labelFor = (code: string) => CATEGORIES.find(([c]) => c === code)?.[1] ?? code;

export const Route = createFileRoute("/expenses")({
  loader: async () => ({ expenses: await expenseRepo.list() }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { expenses } = useLoaderData({ from: "/expenses" });
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIso());
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("software_subs");
  const [description, setDescription] = useState("");
  const [flag, setFlag] = useState(false);

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = parseUSD(amount);
    if (parsed === undefined) {
      toast.error("Enter a valid amount.");
      return;
    }
    await expenseRepo.create({
      date,
      amountCents: parsed,
      category,
      clientId: null,
      description: description || null,
      reason: null,
      notes: null,
      flagForSection179: flag,
      deletedAt: null,
    });
    setAmount("");
    setDescription("");
    setFlag(false);
    toast.success("Expense added.");
    router.invalidate();
  };

  const remove = async (id: string) => {
    await expenseRepo.softDelete(id);
    router.invalidate();
  };

  return (
    <Page
      title="Expenses"
      description="Business expenses. Categorize so the year-end packet groups cleanly."
    >
      <Card className="p-4">
        <form onSubmit={add} className="grid gap-3 @md:grid-cols-[1fr_1fr_1.5fr_2fr_auto_auto]">
          <div className="grid gap-1">
            <Label htmlFor="edate">Date</Label>
            <Input
              id="edate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="eamt">Amount</Label>
            <Input
              id="eamt"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="$0.00"
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ecat">Category</Label>
            <select
              id="ecat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm h-8"
            >
              {CATEGORIES.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="edesc">Description</Label>
            <Input
              id="edesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <input
              id="eflag"
              type="checkbox"
              checked={flag}
              onChange={(e) => setFlag(e.target.checked)}
            />
            <Label htmlFor="eflag" className="text-xs">
              §179
            </Label>
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
            <DataTable.HeaderCell>Category</DataTable.HeaderCell>
            <DataTable.HeaderCell>Description</DataTable.HeaderCell>
            <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
            <DataTable.HeaderCell />
          </DataTable.Row>
        </DataTable.Head>
        <DataTable.Body>
          {expenses.length === 0 ? (
            <DataTable.Empty message="No expenses yet." />
          ) : (
            expenses
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((x) => (
                <DataTable.Row key={x.id}>
                  <DataTable.Cell>
                    <span className="font-mono">{x.date}</span>
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {labelFor(x.category)}
                    {x.flagForSection179 ? (
                      <span className="ml-2 rounded-md bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                        §179
                      </span>
                    ) : null}
                  </DataTable.Cell>
                  <DataTable.Cell>{x.description ?? "—"}</DataTable.Cell>
                  <DataTable.Cell align="right">{formatUSD(cents(x.amountCents))}</DataTable.Cell>
                  <DataTable.Cell align="right">
                    <Button variant="ghost" size="sm" onClick={() => remove(x.id)}>
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
