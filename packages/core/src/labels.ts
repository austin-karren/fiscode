// The one place a stored code gets its human name. The app's pickers and
// tables and the CSV's `…_label` columns both read these maps, so a category
// is called the same thing on screen and in the file handed to an accountant.
//
// Key order is the order a picker lists the options in.

export type LabelMap = Readonly<Record<string, string>>;

export const FILING_STATUS_LABELS = {
  single: "Single",
  mfj: "Married filing jointly",
  mfs: "Married filing separately",
  hoh: "Head of household",
} as const satisfies LabelMap;

export const QUARTERLY_METHOD_LABELS = {
  annualized: "Annualized installment",
  even: "Even split (annual / 4)",
} as const satisfies LabelMap;

export const ENTITY_TYPE_LABELS = {
  sole_prop: "Sole proprietor",
  single_member_llc: "Single-member LLC",
  s_corp: "S corp",
} as const satisfies LabelMap;

export const INCOME_SOURCE_TYPE_LABELS = {
  "1099": "1099 self-employment",
  w2: "W-2 wages",
} as const satisfies LabelMap;

export const INCOME_KIND_LABELS = {
  recurring: "Recurring",
  bonus: "Bonus",
  consulting: "Consulting",
  other: "Other",
} as const satisfies LabelMap;

export const VEHICLE_METHOD_LABELS = {
  standard_mileage: "Standard mileage",
  actual: "Actual expenses",
} as const satisfies LabelMap;

export const HOME_OFFICE_METHOD_LABELS = {
  simplified: "Simplified",
  actual: "Actual expenses",
} as const satisfies LabelMap;

export const EXPENSE_CATEGORY_LABELS = {
  health_insurance: "Self-employed health insurance",
  phone_internet: "Phone / internet",
  software_subs: "Software & subscriptions",
  professional_services: "Professional services",
  meals: "Business meals (50%)",
  equipment: "Equipment",
  home_office: "Home office",
  vehicle: "Vehicle",
  supplies: "Supplies",
  travel: "Travel",
  advertising: "Advertising",
  other: "Other",
} as const satisfies LabelMap;

export const RETIREMENT_ACCOUNT_LABELS = {
  sep: "SEP IRA",
  solo_401k: "Solo 401(k)",
  roth_ira: "Roth IRA",
  trad_ira: "Traditional IRA",
} as const satisfies LabelMap;

/** The label for a code, or the code itself when it is one we don't know. */
export const labelFor = (labels: LabelMap, code: string): string => labels[code] ?? code;

/** A label map as `{ value, label }` items for a select, in the map's order. */
export const labelOptions = (labels: LabelMap): { value: string; label: string }[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
