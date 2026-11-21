import { useRef } from "react";
import { createFileRoute, useLoaderData, useRouter } from "@tanstack/react-router";
import { Button } from "@fiscode/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@fiscode/ui/components/card";
import { cents, formatUSD } from "@fiscode/core";
import { Landmark } from "lucide-react";
import { toast } from "sonner";

import { Page } from "../components/page";
import { DataTable } from "../components/data-table";
import { EnterToSubmitForm } from "../components/forms/enter-to-submit-form";
import { NoDataEmpty } from "../components/empty-states/no-data";
import { SectionTitle } from "../components/section-title";
import { EditPaymentDialog } from "../components/edit-payment-dialog";
import {
  PaymentFields,
  paymentDefaults,
  paymentInsertFrom,
  paymentLabel,
  usePaymentForm,
} from "../components/payment-form";
import {
  defaultAppliedQuarter,
  estimatedPaymentRepo,
  JURISDICTION_LABELS,
} from "../lib/w2-payments-stub";
import { softDeleteWithUndo } from "../lib/soft-delete";
import { focusAfterRemoval } from "../lib/focus-after-removal";
import { formatDate } from "../lib/format-date";
import { useToday } from "../lib/use-today";

export const Route = createFileRoute("/payments")({
  loader: async () => ({ payments: await estimatedPaymentRepo.list() }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const { payments } = useLoaderData({ from: "/payments" });
  const router = useRouter();
  const today = useToday();
  const firstValue = useRef<HTMLInputElement>(null);

  const form = usePaymentForm(paymentDefaults(today), async (value, reset) => {
    await estimatedPaymentRepo.create(paymentInsertFrom(value));
    toast.success("Payment added.");
    // A run of payments shares where they go: keep that, clear the rest.
    reset({ ...paymentDefaults(today), jurisdiction: value.jurisdiction });
    await router.invalidate();
    firstValue.current?.focus();
  });

  const remove = async (row: (typeof payments)[number], from: HTMLElement) => {
    const refocus = focusAfterRemoval(from);
    await softDeleteWithUndo({
      repo: estimatedPaymentRepo,
      row,
      message: "Payment deleted.",
      undoneMessage: "Payment restored.",
      onChange: () => router.invalidate(),
    });
    await router.invalidate();
    refocus();
  };

  return (
    <Page
      title="Payments"
      description="Estimated tax payments you have made, federal and Utah. The dashboard compares them with what is due."
    >
      <EnterToSubmitForm
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <SectionTitle>Add payment</SectionTitle>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-3 pb-2 @sm:grid-cols-2 @4xl:grid-cols-3">
            <PaymentFields form={form} firstValue={firstValue} />
          </CardContent>
          <CardFooter className="justify-end">
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add"}
                </Button>
              )}
            </form.Subscribe>
          </CardFooter>
        </Card>
      </EnterToSubmitForm>

      {payments.length === 0 ? (
        <NoDataEmpty
          icon={Landmark}
          title="No payments yet"
          description="Add each estimated tax payment as you make it, federal or Utah."
        />
      ) : (
        <DataTable>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.HeaderCell>Date paid</DataTable.HeaderCell>
              <DataTable.HeaderCell>Paid to</DataTable.HeaderCell>
              <DataTable.HeaderCell>For</DataTable.HeaderCell>
              <DataTable.HeaderCell>Note</DataTable.HeaderCell>
              <DataTable.HeaderCell align="right">Amount</DataTable.HeaderCell>
              <DataTable.HeaderCell />
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {payments
              .slice()
              .sort((a, b) => (a.date > b.date ? -1 : 1))
              .map((p) => (
                <DataTable.Row key={p.id}>
                  <DataTable.Cell label="Date paid">
                    <span className="whitespace-nowrap">{formatDate(p.date)}</span>
                  </DataTable.Cell>
                  <DataTable.Cell label="Paid to">
                    {JURISDICTION_LABELS[p.jurisdiction]}
                  </DataTable.Cell>
                  <DataTable.Cell label="For">
                    {p.taxYear} Q{p.appliedQuarter ?? defaultAppliedQuarter(p.date, p.taxYear)}
                  </DataTable.Cell>
                  <DataTable.Cell label="Note">{p.notes ?? "—"}</DataTable.Cell>
                  <DataTable.Cell label="Amount" align="right">
                    {formatUSD(cents(p.amountCents))}
                  </DataTable.Cell>
                  <DataTable.Cell align="right">
                    <div className="inline-flex gap-1">
                      <EditPaymentDialog payment={p} onSaved={() => router.invalidate()} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => void remove(p, e.currentTarget)}
                      >
                        Delete <span className="sr-only">{paymentLabel(p, formatDate)}</span>
                      </Button>
                    </div>
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
          </DataTable.Body>
        </DataTable>
      )}
    </Page>
  );
}
