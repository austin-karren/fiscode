import { Input } from "@fiscode/ui/components/input";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

import { optionalMoneyAmountOrZero } from "../lib/field-schemas";
import type { W2JobRow } from "../lib/w2-payments-stub";
import { DatePicker, dateToIso, isoToDate } from "./forms/date-picker";
import { LabelWithTooltip } from "./forms/labeled";
import { SelectWithLabels } from "./forms/select-with-labels";
import { TSFormField } from "./forms/ts-form-field";

// One W-2's form (the taxpayer's own job), shared by the W-2 jobs add card and its Edit dialog.

// The money boxes, in W-2 order: the field, its label, and its hint (with the box number).
export const W2_BOXES = [
  ["wages", "Wages", "Box 1: wages, tips, other compensation. Counts toward income tax."],
  [
    "federalWithholding",
    "Federal tax withheld",
    "Box 2: federal income tax withheld. Counts as paid, one-fourth on each due date.",
  ],
  [
    "ssWages",
    "Social Security wages",
    "Box 3. Lowers the Social Security part of SE tax (Schedule SE line 8a).",
  ],
  ["ssTips", "Social Security tips", "Box 7. Added to box 3 for Schedule SE line 8a."],
  [
    "ssTaxWithheld",
    "Social Security tax withheld",
    "Box 4. Kept for your records; not used in the estimate yet.",
  ],
  [
    "medicareWages",
    "Medicare wages",
    "Box 5. Lowers the Additional Medicare Tax threshold on SE earnings.",
  ],
  [
    "stateWages",
    "Utah wages",
    "Box 16. Kept for your records: Utah tax starts from federal income.",
  ],
  ["stateWithholding", "Utah tax withheld", "Box 17. Counts as paid toward Utah's prepayment."],
] as const;
type BoxField = (typeof W2_BOXES)[number][0];
const COLUMN = {
  wages: "wagesCents",
  federalWithholding: "federalWithholdingCents",
  ssWages: "ssWagesCents",
  ssTips: "ssTipsCents",
  ssTaxWithheld: "ssTaxWithheldCents",
  medicareWages: "medicareWagesCents",
  stateWages: "stateWagesCents",
  stateWithholding: "stateWithholdingCents",
} as const satisfies Record<BoxField, keyof W2JobRow>;

const box = optionalMoneyAmountOrZero;
export const w2Schema = z.object({
  taxYear: z.string(),
  employer: z.string().trim().min(1, "Enter the employer"),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  wages: box,
  federalWithholding: box,
  ssWages: box,
  ssTips: box,
  ssTaxWithheld: box,
  medicareWages: box,
  stateWages: box,
  stateWithholding: box,
  notes: z.string(),
});

type W2Values = {
  taxYear: string;
  employer: string;
  startDate?: Date;
  endDate?: Date;
  notes: string;
} & Record<BoxField, string>;

export const w2Defaults = (year: number): W2Values => ({
  taxYear: String(year),
  employer: "",
  startDate: undefined,
  endDate: undefined,
  notes: "",
  ...(Object.fromEntries(W2_BOXES.map(([f]) => [f, ""])) as Record<BoxField, string>),
});

export const w2ValuesFrom = (row: W2JobRow): W2Values => ({
  taxYear: String(row.taxYear),
  employer: row.employer,
  startDate: row.startDate ? isoToDate(row.startDate) : undefined,
  endDate: row.endDate ? isoToDate(row.endDate) : undefined,
  notes: row.notes ?? "",
  ...(Object.fromEntries(
    W2_BOXES.map(([f]) => [f, ((row[COLUMN[f]] as number) / 100).toFixed(2)]),
  ) as Record<BoxField, string>),
});

export const w2InsertFrom = (value: W2Values) => {
  const parsed = w2Schema.parse(value);
  const boxes = Object.fromEntries(W2_BOXES.map(([f]) => [COLUMN[f], parsed[f] ?? 0])) as Record<
    (typeof COLUMN)[BoxField],
    number
  >;
  return {
    ...boxes,
    taxYear: Number(parsed.taxYear),
    employer: parsed.employer,
    startDate: parsed.startDate ? dateToIso(parsed.startDate) : null,
    endDate: parsed.endDate ? dateToIso(parsed.endDate) : null,
    notes: parsed.notes.trim() || null,
  };
};

export function useW2Form(
  defaultValues: W2Values,
  onSubmit: (value: W2Values, reset: (next?: W2Values) => void) => Promise<void>,
) {
  return useForm({
    defaultValues,
    validators: { onSubmit: w2Schema },
    onSubmit: async ({ value, formApi }) =>
      onSubmit(value, (next) =>
        next ? formApi.reset(next, { keepDefaultValues: true }) : formApi.reset(),
      ),
  });
}
export type W2Form = ReturnType<typeof useW2Form>;

export function W2Fields({
  form,
  year,
  firstValue,
}: {
  form: W2Form;
  /** The estimate year: the form offers it and the year before. */
  year: number;
  firstValue?: React.Ref<HTMLInputElement>;
}) {
  return (
    <>
      <TSFormField form={form} name="taxYear" requirement="required">
        {(field) => (
          <FormItem>
            <FormLabel>Tax year</FormLabel>
            <FormControl>
              <SelectWithLabels
                value={field.state.value}
                onBlur={field.handleBlur}
                onValueChange={(v) => field.handleChange(v)}
                items={[year, year - 1].map((y) => ({ value: String(y), label: String(y) }))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
      <TSFormField
        form={form}
        name="employer"
        requirement="required"
        validators={{ onBlur: w2Schema.shape.employer }}
      >
        {(field) => (
          <FormItem>
            <FormLabel>Employer</FormLabel>
            <FormControl>
              <Input
                ref={firstValue}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </TSFormField>
      {(["startDate", "endDate"] as const).map((name) => (
        <TSFormField key={name} form={form} name={name} requirement="optional">
          {(field) => (
            <FormItem>
              <FormLabel>{name === "startDate" ? "Started" : "Ended"}</FormLabel>
              <FormControl>
                <DatePicker
                  value={field.state.value as Date | undefined}
                  onBlur={field.handleBlur}
                  onValueChange={(d) => field.handleChange(d)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
      ))}
      {W2_BOXES.map(([name, label, hint]) => (
        <TSFormField
          key={name}
          form={form}
          name={name}
          requirement="optional"
          validators={{ onBlur: w2Schema.shape[name] }}
        >
          {(field) => (
            <FormItem>
              <LabelWithTooltip tooltip={hint}>{label}</LabelWithTooltip>
              <FormControl>
                <Input
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
      ))}
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

/** "W-2 from Demo Corp, 2026": a job named for buttons and toasts. */
export const w2Label = (row: W2JobRow) => `W-2 from ${row.employer}, ${row.taxYear}`;
