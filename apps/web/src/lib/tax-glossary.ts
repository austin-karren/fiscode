// Central source for tooltip copy across the app. Keeps the same definition
// from drifting across files. Edit here once when an accountant wants to
// rewrite the prose.

export const GLOSSARY = {
  // ── Core tax math ─────────────────────────────────────────────────────
  seTax:
    "Social Security (12.4% to the SSA wage base) + Medicare (2.9% uncapped) on 92.35% of net business profit. Half is deductible above the line.",
  halfSeDeduction:
    "Half of the regular SE tax (12.4% + 2.9% portions) is deductible above the line. The 0.9% additional Medicare surtax is not.",
  qbi: "Qualified Business Income — up to 20% of net business income for pass-through entities. Phases out above filing-status taxable-income thresholds.",
  netProfit:
    "Gross 1099 income minus deductible business expenses. Does not subtract half-SE-tax or QBI — those come later in the calc.",
  totalLiability:
    "Federal income tax + SE tax + state income tax, before spouse withholding offsets.",
  federalIncomeTax: "Bracket-walked tax on (net profit − ½ SE tax − QBI − standard deduction).",
  stateIncomeTax: "Flat per-state rate applied to taxable income. Utah 2026: 4.55%.",
  remainingOwed:
    "Total liability minus spouse withholding. Distributed across the four quarterly payments.",

  // ── Quarterly payments / safe harbor ──────────────────────────────────
  unevenQuarters:
    "IRS quarters are uneven: Q1 Jan–Mar, Q2 Apr–May, Q3 Jun–Aug, Q4 Sep–Dec. Each is due the 15th of the month after, rolled to the next business day.",
  safeHarbor:
    "Underpayment-penalty floor. Pay at least the lower of 90% of current-year tax or 100% of prior-year tax (110% if prior AGI > $150k) across the four quarters to avoid the penalty.",
  safeHarborCurrent:
    "90% of this year's estimated total liability. Meeting this avoids the underpayment penalty regardless of last year.",
  safeHarborPrior:
    "100% (or 110% if prior AGI exceeded $150k) of last year's total tax. Meeting this avoids the underpayment penalty for the current year.",
  safeHarborFloor:
    "Lower of the two safe-harbor targets. Pay at least this across the four quarterly payments and the IRS won't assess an underpayment penalty.",
  annualizedInstallment:
    "Compute each quarter's required payment from income actually earned through that period. Avoids over-paying when income lands in Q3/Q4.",
  evenSplit:
    "Annual tax estimate divided by four. Simple, but front-loads payments when income is back-loaded.",

  // ── Income / expense classifications ──────────────────────────────────
  income1099:
    "Non-W-2 self-employment income. Subject to SE tax and eligible for QBI; not subject to federal withholding.",
  section179:
    "Section 179 of the IRC: fully expense qualifying business equipment in the year of purchase instead of depreciating it over years. Flag now; pick the actual election with your accountant at year-end.",
  expenseCategory:
    "Category drives how the expense lands in the year-end packet. Some categories (meals, home office, vehicle) have IRS-specific treatment.",

  // ── Vehicle / mileage ─────────────────────────────────────────────────
  standardMileage:
    "IRS per-mile business deduction (2026: $0.725/mi). Alternative is the actual-expense method, which requires receipts and is locked in by the first-year election per vehicle.",
  businessMiles:
    "Miles driven for business that day. Excludes commuting between home and a regular workplace.",
  vehicleMethod:
    "Standard mileage applies the per-year IRS rate. Actual-expense requires receipts. First-year election locks in for owned vehicles.",

  // ── Home office ───────────────────────────────────────────────────────
  regularExclusive:
    "IRS requirement for the home office deduction: the space must be used regularly AND exclusively for business — not the kitchen table or a corner of the living room.",
  homeOfficeMethod:
    "Simplified: $5/sqft, max 300 sqft, $1,500/year cap. Actual: business-use % of rent/mortgage + utilities + insurance; no cap but requires substantiation.",

  // ── Filing / profile ──────────────────────────────────────────────────
  filingStatus:
    "Picks the tax brackets, standard deduction, and SE additional-Medicare threshold. MFJ (married filing jointly) roughly doubles most thresholds vs single.",
  mfj: "Married filing jointly.",
  dependents:
    "Field is captured for future credit calcs (CTC, dependent care). Currently does not affect the tax estimate.",
  prepLeadDays:
    "How many days before each due date the dashboard's 'start preparing around' nudge fires.",
  tracksRoth:
    "Informational only. Roth IRA contributions are post-tax and do not affect this estimate. Your personal accountant tracks the contribution limit separately.",
  usesRetirement:
    "Surface the retirement-deduction UI when active. The SEP-IRA / Solo 401(k) contribution-limit math is not implemented yet — set this once you actually have a plan.",
  quarterlyMethodLabel:
    "How quarterly payments are computed. Annualized adapts to when income lands; even-split divides the year-end estimate by four.",
  spouseBlock:
    "Date-ranged W-2 wages and withholding for a spouse. Spouse withholding is subtracted from required quarterly payments; spouse wages flow into joint AGI for bracket calcs.",
  entityType:
    "Sole prop / single-member LLC are pass-through: business profit lands on Schedule C and is hit with self-employment tax. S corp (not implemented yet) splits owner pay into salary (employment tax) + distribution (no SE tax) — saves SE tax above a profitability threshold but adds payroll and a separate return. Entities are dated periods: don't change retroactively, add a new row from the date you actually switched.",
  seStartDate:
    "When you started this self-employed work. Drives partial-year mileage, home-office, and quarterly bucketing. Change this if you got the original date wrong; don't shift it forward to skip past income.",

  // ── App / data ────────────────────────────────────────────────────────
  backupNudge:
    "Local-only means no cloud backup. The CSV export is the only artifact that leaves your device — keep a recent one in a cloud drive as off-device insurance.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
