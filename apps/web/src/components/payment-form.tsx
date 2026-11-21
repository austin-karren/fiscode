import { Input } from "@fiscode/ui/components/input";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { cents, formatUSD } from "@fiscode/core";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

import { moneyAmount } from "../lib/field-schemas";
import {
  defaultAppliedQuarter,
  defaultTaxYear,
  JURISDICTION_LABELS,
  labelFor,
} from "@fiscode/core";
import type { EstimatedPaymentRow } from "@fiscode/csv";

type Jurisdiction = keyof typeof JURISDICTION_LABELS;
type Quarter = 1 | 2 | 3 | 4;
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { LabelWithTooltip } from "./forms/labeled";
import { SelectWithLabels } from "./forms/select-with-labels";
import { TSFormField } from "./forms/ts-form-field";

// One estimated tax payment's form, shared by the Payments add card and its Edit dialog.

export { defaultTaxYear };

export const paymentSchema = z.object({
  date: z.date({ message: "Pick a date" }),
  amount: moneyAmount,
  jurisdiction: z.enum(["federal", "UT"]),
  taxYear: z.string(),
  // "auto": from the date (stored as null); otherwise "1".."4".
  appliedQuarter: z.enum(["auto", "1", "2", "3", "4"]),
  notes: z.string(),
});
type PaymentValues = {
  date: Date | undefined;
  amount: string;
  jurisdiction: Jurisdiction;
  taxYear: string;
  appliedQuarter: "auto" | "1" | "2" | "3" | "4";
  notes: string;
};

export const paymentDefaults = (today: Date): PaymentValues => ({
  date: today,
  amount: "",
  jurisdiction: "federal",
  taxYear: String(defaultTaxYear(dateToIso(today))),
  appliedQuarter: "auto",
  notes: "",
});

export const paymentValuesFrom = (row: EstimatedPaymentRow, today: Date): PaymentValues => ({
  date: isoToDate(row.date) ?? today,
  amount: (row.amountCents / 100).toFixed(2),
  jurisdiction: row.jurisdiction as Jurisdiction,
  taxYear: String(row.taxYear),
  appliedQuarter: row.appliedQuarter === null ? "auto" : (String(row.appliedQuarter) as "1"),
  notes: row.notes ?? "",
});

export const paymentInsertFrom = (value: PaymentValues) => {
  const parsed = paymentSchema.parse(value);
  return {
    date: dateToIso(parsed.date),
    amountCents: parsed.amount,
    jurisdiction: parsed.jurisdiction,
    taxYear: Number(parsed.taxYear),
    // Utah has one prepayment date, not quarters: no quarter is stored for it.
    appliedQuarter:
      parsed.jurisdiction === "UT" || parsed.appliedQuarter === "auto"
        ? null
        : (Number(parsed.appliedQuarter) as Quarter),
    notes: parsed.notes.trim() || null,
  };
};

export function usePaymentForm(
  defaultValues: PaymentValues,
  onSubmit: (value: PaymentValues, reset: (next?: PaymentValues) => void) => Promise<void>,
) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: paymentSchema },
    onSubmit: async ({ value, formApi }) =>
      onSubmit(value, (next) =>
        next ? formApi.reset(next, { keepDefaultValues: true }) : formApi.reset(),
      ),
  });
  return form;
}
export type PaymentForm = ReturnType<typeof usePaymentForm>;

export function PaymentFields({
  form,
  firstValue,
}: {
  form: PaymentForm;
  firstValue?: React.Ref<HTMLInputElement>;
}) {
  return (
    <>
      <TSFormField
        form={form}
        name="date"
        requirement="required"
        validators={{ onBlur: paymentSchema.shape.date }}
      >
        {(field) => (
          <FormItem>
            <LabelWithTooltip tooltip="The day the payment was made: the debit date, or the postmark for a check. Payments are dated today or earlier.">
              Date paid
            </LabelWithTooltip>
            <FormControl>
              <DatePicker
                value={field.state.value as Date | undefined}
                onBlur={field.handleBlur}
                onValueChange={(d) => {
                  field.handleChange(d);
                  // The year follows the date until the user picks one.
                  if (d && !form.getFieldMeta("taxYear")?.isDirty) {
                    form.setFieldValue("taxYear", String(defaultTaxYear(dateToIso(d))), {
                      dontUpdateMeta: true,
                    });
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
      <TSFormField
        form={form}
        name="amount"
        requirement="required"
        validators={{ onBlur: paymentSchema.shape.amount }}
      >
        {(field) => (
          <FormItem>
            <FormLabel>Amount</FormLabel>
            <FormControl>
              <Input
                ref={firstValue}
                inputMode="decimal"
                placeholder="$0.00"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
      <TSFormField form={form} name="jurisdiction" requirement="required">
        {(field) => (
          <FormItem>
            <FormLabel>Paid to</FormLabel>
            <FormControl>
              <SelectWithLabels
                value={field.state.value}
                onBlur={field.handleBlur}
                onValueChange={(v) => field.handleChange(v as Jurisdiction)}
                items={(Object.keys(JURISDICTION_LABELS) as Jurisdiction[]).map((j) => ({
                  value: j,
                  label: JURISDICTION_LABELS[j],
                }))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
      <form.Subscribe selector={(s) => s.values.date}>
        {(date) => {
          const thisYear = date ? Number(dateToIso(date).slice(0, 4)) : new Date().getFullYear();
          return (
            <TSFormField form={form} name="taxYear" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip="The year the payment is for. A payment made by January 15 is usually the previous year's fourth quarter.">
                    For tax year
                  </LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v)}
                      items={[thisYear, thisYear - 1].map((y) => ({
                        value: String(y),
                        label: String(y),
                      }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          );
        }}
      </form.Subscribe>
      <form.Subscribe
        selector={(s) => ({
          date: s.values.date,
          taxYear: s.values.taxYear,
          utah: s.values.jurisdiction === "UT",
        })}
      >
        {({ date, taxYear, utah }) => {
          // Utah's prepayment has one due date and no quarters.
          if (utah) return null;
          const auto = date ? defaultAppliedQuarter(dateToIso(date), Number(taxYear)) : 1;
          return (
            <TSFormField form={form} name="appliedQuarter" requirement="required">
              {(field) => (
                <FormItem>
                  <LabelWithTooltip tooltip="Which quarter's installment this payment is for. By default, the first due date on or after the date paid.">
                    Applied to
                  </LabelWithTooltip>
                  <FormControl>
                    <SelectWithLabels
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onValueChange={(v) => field.handleChange(v as "auto")}
                      items={[
                        { value: "auto", label: `Q${auto} (from the date)` },
                        ...(["1", "2", "3", "4"] as const).map((q) => ({
                          value: q,
                          label: `Q${q}`,
                        })),
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            </TSFormField>
          );
        }}
      </form.Subscribe>
      <TSFormField form={form} name="notes" requirement="optional">
        {(field) => (
          <FormItem>
            <FormLabel>Note</FormLabel>
            <FormControl>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
    </>
  );
}

/** "Federal $1,200.00 on Apr 10, 2026": a payment named for buttons and toasts. */
export const paymentLabel = (row: EstimatedPaymentRow, formatDate: (iso: string) => string) =>
  `${labelFor(JURISDICTION_LABELS, row.jurisdiction)} payment ${formatUSD(cents(row.amountCents))} on ${formatDate(row.date)}`;
