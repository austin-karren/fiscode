import { HOME_OFFICE_METHOD_LABELS, labelOptions } from "@fiscode/core";
import { FormControl, FormItem, FormLabel, FormMessage } from "@fiscode/ui/components/form";
import { Input } from "@fiscode/ui/components/input";
import type { AnyFieldApi } from "@tanstack/react-form";

import { GLOSSARY } from "../lib/tax-glossary";
import { homeOfficeFieldSchemas as fs, officeAreaError } from "../lib/home-office-form";
import { CONFIG_YEARS_BACK, DatePicker } from "./forms/date-picker";
import { LabelWithTooltip } from "./forms/labeled";
import { SelectWithLabels } from "./forms/select-with-labels";
import { TSFormField } from "./forms/ts-form-field";

const METHOD_OPTIONS = labelOptions(HOME_OFFICE_METHOD_LABELS);

// The office's blur check: a whole number, and no larger than the home.
const officeOnBlur = ({ value, fieldApi }: { value: string; fieldApi: AnyFieldApi }) => {
  const own = fs.officeSqft.safeParse(value);
  if (!own.success) return own.error.issues[0]?.message;
  return officeAreaError(value, String(fieldApi.form.getFieldValue("homeSqft") ?? ""));
};

/** A money field holding monthly cents as text ("1375.00"). */
function MoneyField({
  form,
  name,
  label,
  hint,
}: {
  form: any;
  name: "rentMortgage" | "utilities" | "insurance";
  label: string;
  hint?: string;
}) {
  return (
    <TSFormField form={form} name={name} requirement="optional" validators={{ onBlur: fs[name] }}>
      {(field) => (
        <FormItem>
          {hint ? (
            <LabelWithTooltip tooltip={hint}>{label}</LabelWithTooltip>
          ) : (
            <FormLabel>{label}</FormLabel>
          )}
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
  );
}

/**
 * The fields of a home office config, shared by the add form and the Edit
 * dialog. The monthly costs show when the method is Actual (Form 8829): the
 * engine reads them only for that method.
 *
 * `methodError` is a refusal from outside the field's validators (a second
 * simplified home in a year). Dates keep their existing limits: a start date
 * is not in the future; an end date may be.
 */
export function HomeOfficeFields({ form, methodError }: { form: any; methodError?: string }) {
  return (
    <>
      <div className="grid items-start gap-3 @sm:grid-cols-2 @4xl:grid-cols-5">
        <TSFormField
          form={form}
          name="startDate"
          requirement="required"
          validators={{ onBlur: fs.startDate }}
        >
          {(field) => (
            <FormItem>
              <FormLabel>Start date</FormLabel>
              <FormControl>
                <DatePicker
                  yearsBack={CONFIG_YEARS_BACK}
                  value={field.state.value as Date | undefined}
                  onBlur={field.handleBlur}
                  onValueChange={(d) => field.handleChange(d)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
        <TSFormField form={form} name="endDate" requirement="optional">
          {(field) => (
            <FormItem>
              <FormLabel>End date</FormLabel>
              <FormControl>
                <DatePicker
                  yearsBack={CONFIG_YEARS_BACK}
                  disableFuture={false}
                  value={field.state.value as Date | undefined}
                  onBlur={field.handleBlur}
                  onValueChange={(d) => field.handleChange(d)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
        <TSFormField form={form} name="method" requirement="required" error={methodError}>
          {(field) => (
            <FormItem>
              <LabelWithTooltip tooltip={GLOSSARY.homeOfficeMethod}>Method</LabelWithTooltip>
              <FormControl>
                <SelectWithLabels
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onValueChange={(v) => field.handleChange(v)}
                  items={METHOD_OPTIONS}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
        <TSFormField
          form={form}
          name="officeSqft"
          requirement="optional"
          // Re-checked when Home sqft is blurred too: raising the home can
          // clear the message without touching the office field.
          validators={{ onBlur: officeOnBlur, onBlurListenTo: ["homeSqft"] }}
        >
          {(field) => (
            <FormItem>
              <FormLabel>Office sqft</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
        <TSFormField
          form={form}
          name="homeSqft"
          requirement="optional"
          validators={{ onBlur: fs.homeSqft }}
        >
          {(field) => (
            <FormItem>
              <FormLabel>Home sqft</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </TSFormField>
      </div>
      <form.Subscribe selector={(s: { values: { method: string } }) => s.values.method}>
        {(method: string) =>
          method === "actual" ? (
            <div className="grid items-start gap-3 @sm:grid-cols-3" data-testid="actual-costs">
              <MoneyField
                form={form}
                name="rentMortgage"
                label="Rent or mortgage interest, monthly"
                hint="Owners: enter the monthly mortgage interest, not the full payment. Principal is not deductible."
              />
              <MoneyField form={form} name="utilities" label="Utilities, monthly" />
              <MoneyField form={form} name="insurance" label="Insurance, monthly" />
            </div>
          ) : null
        }
      </form.Subscribe>
    </>
  );
}
