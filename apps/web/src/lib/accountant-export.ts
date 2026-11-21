import {
  EXPENSE_CATEGORY_LABELS,
  FILING_STATUS_LABELS,
  INCOME_KIND_LABELS,
  INCOME_SOURCE_TYPE_LABELS,
  JURISDICTION_LABELS,
  countedExpenseDate,
  countedInYear,
  defaultAppliedQuarter,
  expensesCountedForYear,
  labelFor,
} from "@fiscode/core";
import { guardText, type Bundle } from "@fiscode/csv";
import { estimateBundleYear, getYearConfig, mileageRateOn } from "@fiscode/tax";

// The accountant summary: a second, export-only file beside the canonical yearly CSV. It is for
// reading in Excel, Sheets or Numbers: tidy tables, totals, and the figures fiscode derives
// (mileage per trip, Schedule C totals, SE health insurance, the section 195 split, W-2s and
// payments, the estimate). It is never imported: it has no `record_type` header, so the importer
// refuses it, and its first table says so. The canonical CSV and its lossless round trip are
// untouched.
//
// Layout: tables one after another, a blank row between. Each table's first row is its header;
// column 1 of every row is the table's name, so a filter on it isolates one table. Dollars are
// numbers with 2 decimals and no symbol; dates are ISO (YYYY-MM-DD). UTF-8 with a BOM and CRLF,
// so Excel reads accents and line ends as the other two do.

type Cell = string | number | null | undefined;

/** Cents as dollars with 2 decimals ("1234.56", "-45.00"); blank when absent. */
const usd = (c: number | null | undefined): string =>
  c === null || c === undefined ? "" : (c / 100).toFixed(2);

/** One cell: text guarded against formulas, quoted when it holds a comma, quote or line break. */
const cell = (v: Cell, text = true): string => {
  if (v === null || v === undefined) return "";
  const s = text ? guardText(String(v)) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type Table = { name: string; header: string[]; rows: Cell[][]; numeric?: Set<string> };

const writeTable = ({ name, header, rows, numeric = new Set() }: Table): string =>
  [
    [name, ...header].map((h) => cell(h)).join(","),
    ...rows.map((r) =>
      [cell(name), ...r.map((v, i) => cell(v, !numeric.has(header[i]!)))].join(","),
    ),
  ].join("\r\n");

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** The file name: year, date, and that it is a summary (never the yearly CSV's name). */
export const accountantExportFileName = (year: number, today: string): string =>
  `fiscode-${year}-accountant-summary-${today}.csv`;

/**
 * The accountant summary for `year`, as CSV text. `bundle` is live rows (deleted rows are left
 * out, as the estimate leaves them out). `today` is the date printed in the file.
 */
export const accountantExport = (bundle: Bundle, year: number, today: string): string => {
  const profile = bundle.profile;
  if (!profile) throw new Error("accountantExport: profile is required");
  const { result, derived } = estimateBundleYear(bundle, year);
  const cfg = getYearConfig(year);
  const se = profile.seStartDate;
  const clientName = new Map(bundle.clients.map((c) => [c.id, c.name]));
  const vehicleName = new Map(
    bundle.vehicles.map((v) => [v.id, [v.year, v.make, v.model].filter(Boolean).join(" ")]),
  );
  const tables: Table[] = [];

  tables.push({
    name: "About this file",
    header: ["item", "value"],
    rows: [
      ["File", `fiscode accountant summary for ${year}`],
      ["Created", today],
      [
        "Importable",
        "No. This is a summary for reading. To move data into fiscode, use the yearly CSV.",
      ],
      ["Filing status", labelFor(FILING_STATUS_LABELS, profile.filingStatus)],
      ["State", profile.state],
      ["Self-employment start", se],
      [
        "Rows",
        "Rows that count toward the year, as the estimate counts them: dated in the year and on or after the self-employment start. Deleted rows are left out.",
      ],
      [
        "Mileage",
        "Each trip at the standard rate in force on its date. The total is figured once per rate, so it can differ from the sum of the trips by a cent.",
      ],
    ],
  });

  const e = result.estimate;
  const summary: [string, number][] = [
    ["Gross 1099 income", derived.gross1099],
    ["Schedule C expenses (incl. section 195 deducted this year)", derived.directExpenses],
    ["Mileage deduction", derived.mileageDeduction],
    ["Home office deduction", derived.homeOfficeDeduction],
    ["Total deductible expenses", derived.totalDeductibleExpenses],
    ["Net profit (Schedule C line 31)", e.netProfit],
    ["Self-employment tax", e.se.totalSeTax],
    ["Deductible half of SE tax (Schedule 1 line 15)", e.se.halfSeTaxDeduction],
    ["Self-employed health insurance (Schedule 1 line 17)", e.selfEmployedHealthInsurance],
    ["Own W-2 wages", derived.ownW2Wages],
    ["Adjusted gross income", e.agi],
    ["QBI deduction", e.federal.qbiDeduction],
    ["Federal taxable income", e.federal.taxableIncome],
    ["Federal income tax", e.federal.federalIncomeTax],
    ["State income tax", e.state.stateIncomeTax],
    ["Total liability (federal + state)", e.totalLiability],
    ["Safe-harbor floor (required annual payment)", result.safeHarbor.floor],
    ["Federal paid (withholding + estimates)", result.payments.federal.totalPaid],
    ["Federal remaining to the floor", result.payments.federal.remaining],
  ];
  tables.push({
    name: "Estimate summary",
    header: ["line", "amount"],
    rows: summary.map(([l, c]) => [l, usd(c)]),
    numeric: new Set(["amount"]),
  });

  // Schedule C: the year's counted expenses except SE health insurance (Schedule 1 line 17),
  // by category, plus the section 195 amount deducted this year.
  const counted = expensesCountedForYear(bundle.expenses, year, se);
  const scheduleC = counted.filter((x) => x.category !== "health_insurance");
  const byCategory = new Map<string, { rows: number; cents: number }>();
  for (const x of scheduleC) {
    const t = byCategory.get(x.category) ?? { rows: 0, cents: 0 };
    byCategory.set(x.category, { rows: t.rows + 1, cents: t.cents + x.amountCents });
  }
  const categoryRows: Cell[][] = [...byCategory]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, t]) => [labelFor(EXPENSE_CATEGORY_LABELS, code), code, t.rows, usd(t.cents)]);
  const startupThisYear = derived.startupCosts.deductedThisYear;
  if (startupThisYear > 0) {
    categoryRows.push([
      "Start-up costs (section 195) deducted this year",
      "section_195",
      "",
      usd(startupThisYear),
    ]);
  }
  categoryRows.push(["Total", "", scheduleC.length, usd(derived.directExpenses)]);
  tables.push({
    name: "Schedule C expenses by category",
    header: ["category", "code", "rows", "amount"],
    rows: categoryRows,
    numeric: new Set(["rows", "amount"]),
  });

  const income = countedInYear(bundle.income, year, se).toSorted((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  tables.push({
    name: "Income",
    header: ["date", "client", "source_type", "kind", "description", "amount", "amount_1099"],
    rows: [
      ...income.map((i) => [
        i.date,
        i.clientId ? clientName.get(i.clientId) : "",
        labelFor(INCOME_SOURCE_TYPE_LABELS, i.sourceType),
        labelFor(INCOME_KIND_LABELS, i.kind),
        i.description,
        usd(i.amountCents),
        i.sourceType === "1099" ? usd(i.amountCents) : "",
      ]),
      ["Total", "", "", "", "", usd(sum(income.map((i) => i.amountCents))), usd(derived.gross1099)],
    ],
    numeric: new Set(["amount", "amount_1099"]),
  });

  tables.push({
    name: "Expenses",
    header: [
      "date",
      "counted_on",
      "category",
      "description",
      "client",
      "section_179_candidate",
      "startup",
      "amount",
    ],
    rows: [
      ...counted
        .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((x) => [
          x.date,
          countedExpenseDate(x, se),
          labelFor(EXPENSE_CATEGORY_LABELS, x.category),
          x.description,
          x.clientId ? clientName.get(x.clientId) : "",
          x.flagForSection179 ? "yes" : "no",
          x.startupExpense ? "yes" : "no",
          usd(x.amountCents),
        ]),
      ["Total", "", "", "", "", "", "", usd(sum(counted.map((x) => x.amountCents)))],
    ],
    numeric: new Set(["amount"]),
  });

  const trips = countedInYear(bundle.mileage, year, se).toSorted((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  tables.push({
    name: "Mileage",
    header: ["date", "vehicle", "purpose", "business_miles", "rate_per_mile", "deduction"],
    rows: [
      ...trips.map((t) => {
        const rate = mileageRateOn(cfg, t.date);
        return [
          t.date,
          t.vehicleId ? vehicleName.get(t.vehicleId) : "",
          t.purpose,
          t.businessMiles,
          rate.toFixed(3),
          usd(Math.round(t.businessMiles * rate * 100)),
        ];
      }),
      ["Total", "", "", sum(trips.map((t) => t.businessMiles)), "", usd(derived.mileageDeduction)],
    ],
    numeric: new Set(["business_miles", "rate_per_mile", "deduction"]),
  });

  tables.push({
    name: "Start-up costs (section 195)",
    header: ["item", "amount"],
    rows: [
      ["Paid before the business began", usd(derived.startupCosts.total)],
      ["Deducted this year", usd(derived.startupCosts.deductedThisYear)],
      ["Left to deduct after this year", usd(derived.startupCosts.remainingAfterYear)],
    ],
    numeric: new Set(["amount"]),
  });

  const w2s = bundle.w2Jobs.filter((w) => w.deletedAt === null && w.taxYear === year);
  const w2Money = [
    ["wages", "wagesCents"],
    ["federal_withholding", "federalWithholdingCents"],
    ["ss_wages", "ssWagesCents"],
    ["ss_tax_withheld", "ssTaxWithheldCents"],
    ["medicare_wages", "medicareWagesCents"],
    ["ss_tips", "ssTipsCents"],
    ["state_wages", "stateWagesCents"],
    ["state_withholding", "stateWithholdingCents"],
  ] as const;
  tables.push({
    name: "W-2 jobs",
    header: ["employer", "start_date", "end_date", ...w2Money.map(([h]) => h)],
    rows: [
      ...w2s.map((w) => [w.employer, w.startDate, w.endDate, ...w2Money.map(([, k]) => usd(w[k]))]),
      ["Total", "", "", ...w2Money.map(([, k]) => usd(sum(w2s.map((w) => w[k]))))],
    ],
    numeric: new Set(w2Money.map(([h]) => h)),
  });

  const payments = bundle.estimatedPayments
    .filter((p) => p.deletedAt === null && p.taxYear === year)
    .toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const paidIn = (j: string) =>
    sum(payments.filter((p) => p.jurisdiction === j).map((p) => p.amountCents));
  tables.push({
    name: "Estimated payments",
    header: ["date", "jurisdiction", "applied_quarter", "notes", "amount"],
    rows: [
      ...payments.map((p) => [
        p.date,
        labelFor(JURISDICTION_LABELS, p.jurisdiction),
        p.appliedQuarter ?? defaultAppliedQuarter(p.date, year),
        p.notes,
        usd(p.amountCents),
      ]),
      ["Total federal", "", "", "", usd(paidIn("federal"))],
      ["Total Utah", "", "", "", usd(paidIn("UT"))],
    ],
    numeric: new Set(["applied_quarter", "amount"]),
  });

  tables.push({
    name: "Federal payments by quarter",
    header: ["quarter", "due_date", "required_through", "paid_by_due_date", "shortfall"],
    rows: result.payments.federal.quarters.map((q) => [
      q.quarter,
      q.dueDate,
      usd(q.requiredThrough),
      usd(q.paidByDueDate),
      usd(q.shortfall),
    ]),
    numeric: new Set(["quarter", "required_through", "paid_by_due_date", "shortfall"]),
  });

  return `﻿${tables.map(writeTable).join("\r\n\r\n")}\r\n`;
};
