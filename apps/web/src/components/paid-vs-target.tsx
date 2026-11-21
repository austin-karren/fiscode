import { Badge } from "@fiscode/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { cents, formatUSD } from "@fiscode/core";
import { Link } from "@tanstack/react-router";

import type { PaymentsResult } from "../lib/w2-payments-stub";
import { formatDate } from "../lib/format-date";
import { DataTable } from "./data-table";
import { SectionTitle } from "./section-title";

const usd = (c: number) => formatUSD(cents(c));

// What has been paid against what is due, per jurisdiction, from the engine's `payments`
// (withholding counts one-fourth on each due date; estimates count on the day paid). It shows
// shortfalls only: there is no penalty calculation yet, and it says so.
export function PaidVsTarget({
  payments,
  today,
  noneRequired,
}: {
  payments: PaymentsResult;
  today: string;
  /** The $1,000 rule (quarterly.noInstallmentsRequired): nothing is due, so nothing is short. */
  noneRequired: boolean;
}) {
  const { federal, state } = payments;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionTitle>
            Paid so far
            {federal.safeHarborMet || noneRequired ? (
              <Badge variant="secondary">On track</Badge>
            ) : null}
          </SectionTitle>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {noneRequired ? (
          <p className="text-sm">
            <span className="font-medium">Federal:</span> {usd(federal.totalPaid)} paid (
            {usd(federal.withholding)} withheld, {usd(federal.estimates)} in payments).{" "}
            <span className="font-medium">No payment required:</span> under $1,000 owed after
            withholding.
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-medium">Federal:</span> {usd(federal.totalPaid)} paid of{" "}
            {usd(federal.target)} ({usd(federal.withholding)} withheld, {usd(federal.estimates)} in
            payments). <span className="font-medium">{usd(federal.remaining)} still due.</span>
          </p>
        )}
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Quarter</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Due by then</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Paid by then</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Short</DataTable.HeaderCell>
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {federal.quarters.map((q) => (
              <DataTable.Row
                key={q.quarter}
                // Past quarters recede, as on the payment cards above.
                className={q.dueDate < today ? "text-muted-foreground" : ""}
              >
                <DataTable.Cell label="Quarter">
                  Q{q.quarter}, due {formatDate(q.dueDate)}
                </DataTable.Cell>
                <DataTable.Cell label="Due by then" align="right">
                  {usd(q.requiredThrough)}
                </DataTable.Cell>
                <DataTable.Cell label="Paid by then" align="right">
                  {usd(q.paidByDueDate)}
                </DataTable.Cell>
                <DataTable.Cell label="Short" align="right">
                  {q.shortfall > 0 && !noneRequired ? usd(q.shortfall) : "—"}
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable.Body>
        </DataTable>
        {state ? (
          <p className="text-sm">
            <span className="font-medium">Utah:</span> {usd(state.totalPaid)} paid (
            {usd(state.withholding)} withheld, {usd(state.estimates)} in payments).{" "}
            <span className="font-medium">
              {usd(state.remaining)} still due by {formatDate(state.dueDate)}.
            </span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Shortfalls only: fiscode doesn't calculate an underpayment penalty yet. Record payments on{" "}
          <Link to="/payments">Payments</Link> and W-2s on <Link to="/w2-jobs">W-2 jobs</Link>.
        </p>
      </CardContent>
    </Card>
  );
}
