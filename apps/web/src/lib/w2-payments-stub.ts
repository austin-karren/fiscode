// STUB of d-data's DF-07 contract (dispatchers/d-data/drafts/contract-w2-payments.md): own W-2
// jobs, estimated payments, priorYearNotFiled, and the engine's `result.payments` and
// `safeHarbor.priorYearBasis`. Names and shapes are the contract's. Rows live in memory only.
//
// When d-data's PR merges: delete this file, and import the row types and repos from
// @fiscode/db, the outputs from estimateBundleYear (@fiscode/tax), the labels from @fiscode/core.
// Every reader imports from here, so that is the one change.
import type { IsoDate } from "@fiscode/core";

type Dated = { id: string; createdAt: string; updatedAt: string; deletedAt: string | null };

/** One W-2 (one employer, one tax year): the taxpayer's own. Money in cents; boxes in comments. */
export type W2JobRow = Dated & {
  taxYear: number;
  employer: string;
  /** First and last day worked that year: shown, not used in the math. */
  startDate: string | null;
  endDate: string | null;
  wagesCents: number; // box 1
  federalWithholdingCents: number; // box 2
  ssWagesCents: number; // box 3
  ssTipsCents: number; // box 7 (d-data: its own column; the engine adds it to box 3)
  ssTaxWithheldCents: number; // box 4
  medicareWagesCents: number; // box 5
  stateWagesCents: number; // box 16
  stateWithholdingCents: number; // box 17
  notes: string | null;
};

export type Jurisdiction = "federal" | "UT";
export type Quarter = 1 | 2 | 3 | 4;

export type EstimatedPaymentRow = Dated & {
  date: string;
  amountCents: number;
  jurisdiction: Jurisdiction;
  /** The year it is for: a January 15 payment is the prior year's Q4. */
  taxYear: number;
  /** Null: derived from the date, using `taxYear`'s due dates. */
  appliedQuarter: Quarter | null;
  notes: string | null;
};

export type PriorYearBasis = "entered" | "not_entered" | "not_filed";

/** `estimateBundleYear(...).result.payments` (contract §5). */
export type PaymentsResult = {
  federal: {
    withholding: number;
    estimates: number;
    totalPaid: number;
    target: number;
    remaining: number;
    quarters: {
      quarter: Quarter;
      dueDate: IsoDate;
      requiredThrough: number;
      paidByDueDate: number;
      shortfall: number;
      paidAppliedHere: number;
    }[];
    safeHarborMet: boolean;
  };
  state:
    | {
        withholding: number;
        estimates: number;
        totalPaid: number;
        minimumBeforePayments: number;
        remaining: number;
        dueDate: IsoDate;
      }
    | undefined;
};

// @fiscode/core exports these four from d-data #79 (JURISDICTION_LABELS, federalDueDates,
// defaultTaxYear, defaultAppliedQuarter), with these signatures; until it merges they are here.
export const JURISDICTION_LABELS: Record<Jurisdiction, string> = { federal: "Federal", UT: "Utah" };

// ─── Repos: the makeCrudRepo API, in memory ─────────────────────────────────

type Insert<TRow extends Dated> = Omit<TRow, "id" | "createdAt" | "updatedAt" | "deletedAt"> & {
  deletedAt?: string | null;
};

function memoryRepo<TRow extends Dated>(prefix: string, sortKey: (r: TRow) => string) {
  const rows = new Map<string, TRow>();
  let n = 0;
  const sorted = (all: TRow[]) => all.toSorted((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return {
    async list(): Promise<TRow[]> {
      return sorted([...rows.values()].filter((r) => r.deletedAt === null));
    },
    async listIncludingDeleted(): Promise<TRow[]> {
      return sorted([...rows.values()]);
    },
    async get(id: string): Promise<TRow | undefined> {
      return rows.get(id);
    },
    async create(input: Insert<TRow>): Promise<TRow> {
      const now = new Date().toISOString();
      const row = {
        ...input,
        deletedAt: null,
        id: `${prefix}_${++n}`,
        createdAt: now,
        updatedAt: now,
      } as TRow;
      rows.set(row.id, row);
      return row;
    },
    async update(id: string, patch: Partial<Insert<TRow>>): Promise<TRow | undefined> {
      const row = rows.get(id);
      if (!row) return undefined;
      const next = { ...row, ...patch, updatedAt: new Date().toISOString() } as TRow;
      rows.set(id, next);
      return next;
    },
    async softDelete(id: string): Promise<boolean> {
      const row = rows.get(id);
      if (!row || row.deletedAt) return false;
      rows.set(id, { ...row, deletedAt: new Date().toISOString() });
      return true;
    },
    async revertTo(id: string, snapshot: TRow): Promise<TRow | undefined> {
      rows.set(id, snapshot);
      return snapshot;
    },
  };
}

export const w2JobRepo = memoryRepo<W2JobRow>("w2", (r) => `${r.taxYear}${r.startDate ?? ""}`);
export const estimatedPaymentRepo = memoryRepo<EstimatedPaymentRow>("pay", (r) => r.date);

/** profile.prior_year_not_filed, stamped with the year it is for (contract §1). */
export const priorYearNotFiledStore = { year: null as number | null };
export const priorYearNotFiledFor = (year: number) => priorYearNotFiledStore.year === year - 1;
/** Saves the flag: stamped with the year it is for, or cleared. */
export const setPriorYearNotFiled = (forYear: number | null) => {
  priorYearNotFiledStore.year = forYear;
};

// ─── Engine outputs, approximated for the stub ──────────────────────────────

/** Federal due dates for `taxYear` (Q4 is January 15 of the next year). */
export const federalDueDates = (taxYear: number): [IsoDate, IsoDate, IsoDate, IsoDate] =>
  [`${taxYear}-04-15`, `${taxYear}-06-15`, `${taxYear}-09-15`, `${taxYear + 1}-01-15`] as [
    IsoDate,
    IsoDate,
    IsoDate,
    IsoDate,
  ];

/** The year a payment dated `date` is for by default: on or before the January due date, last year. */
export const defaultTaxYear = (date: string): number => {
  const year = Number(date.slice(0, 4));
  return date <= `${year}-01-15` ? year - 1 : year;
};

/** The quarter a payment dated `date` goes to by default: the first due date on or after it. */
export const defaultAppliedQuarter = (
  date: string,
  taxYear: number = defaultTaxYear(date),
): Quarter => {
  const i = federalDueDates(taxYear).findIndex((due) => date <= due);
  return (i === -1 ? 4 : i + 1) as Quarter;
};

/**
 * Contract §5's `payments` from the rows, for the stub: withholding counts one-fourth per due date
 * (R4), estimates on their dates (R5), the target is the safe harbor floor. The real engine
 * replaces this.
 */
export function stubPayments({
  year,
  floor: safeHarborFloor,
  noInstallmentsRequired = false,
  spouseFederalWithholding = 0,
  utahMinimumBeforePayments,
  utahDueDate,
  jobs,
  payments,
}: {
  year: number;
  floor: number;
  /** The $1,000 rule: the target is 0 (#79). */
  noInstallmentsRequired?: boolean;
  /** The spouse's federal withholding on a joint return: withholding is own box 2 plus this (R4). */
  spouseFederalWithholding?: number;
  utahMinimumBeforePayments: number | undefined;
  utahDueDate: IsoDate | undefined;
  jobs: W2JobRow[];
  payments: EstimatedPaymentRow[];
}): PaymentsResult {
  const floor = noInstallmentsRequired ? 0 : safeHarborFloor;
  const live = <T extends Dated & { taxYear: number }>(rows: T[]) =>
    rows.filter((r) => r.deletedAt === null && r.taxYear === year);
  const ownJobs = live(jobs);
  const pays = live(payments);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const fedPays = pays.filter((p) => p.jurisdiction === "federal");
  const utPays = pays.filter((p) => p.jurisdiction === "UT");
  const withholding = sum(ownJobs.map((j) => j.federalWithholdingCents)) + spouseFederalWithholding;
  const estimates = sum(fedPays.map((p) => p.amountCents));
  const dues = federalDueDates(year);
  const quarters = dues.map((dueDate, i) => {
    const q = (i + 1) as Quarter;
    const requiredThrough = Math.round((floor * q) / 4);
    const paidByDueDate =
      Math.round((withholding * q) / 4) +
      sum(fedPays.filter((p) => p.date <= dueDate).map((p) => p.amountCents));
    return {
      quarter: q,
      dueDate,
      requiredThrough,
      paidByDueDate,
      shortfall: Math.max(0, requiredThrough - paidByDueDate),
      paidAppliedHere: sum(
        fedPays
          .filter((p) => (p.appliedQuarter ?? defaultAppliedQuarter(p.date, year)) === q)
          .map((p) => p.amountCents),
      ),
    };
  });
  const stateWithholding = sum(ownJobs.map((j) => j.stateWithholdingCents));
  const stateEstimates = sum(utPays.map((p) => p.amountCents));
  return {
    federal: {
      withholding,
      estimates,
      totalPaid: withholding + estimates,
      target: floor,
      remaining: Math.max(0, floor - withholding - estimates),
      quarters,
      safeHarborMet: quarters.every((q) => q.shortfall === 0),
    },
    state:
      utahMinimumBeforePayments === undefined || utahDueDate === undefined
        ? undefined
        : {
            withholding: stateWithholding,
            estimates: stateEstimates,
            totalPaid: stateWithholding + stateEstimates,
            minimumBeforePayments: utahMinimumBeforePayments,
            remaining: Math.max(0, utahMinimumBeforePayments - stateWithholding - stateEstimates),
            dueDate: utahDueDate,
          },
  };
}
