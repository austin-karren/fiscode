import type {
  AnnualizedInput,
  QuarterlyPlan,
  TaxEstimate,
  TaxInput,
  YearConfig,
} from "../types.ts";
import type { QuarterlyMethod } from "@fiscode/core";
import { NotImplementedError, type TaxStrategy } from "./types.ts";

// Seam placeholder. S-corp adds a reasonable-salary input, payroll taxes via
// FICA (employer + employee), a separate quarterly payroll deposit schedule,
// pass-through K-1 income with no SE tax, and a shifted QBI calc. Implement
// when the user actually elects S status — until then, refusing-loudly keeps
// the type system honest.
export const sCorpStrategy: TaxStrategy = {
  id: "s_corp",
  compute(_input: TaxInput, _cfg: YearConfig): TaxEstimate {
    throw new NotImplementedError("SCorpStrategy.compute");
  },
  quarterly(
    _input: TaxInput | AnnualizedInput,
    _cfg: YearConfig,
    _method: QuarterlyMethod,
  ): QuarterlyPlan {
    throw new NotImplementedError("SCorpStrategy.quarterly");
  },
};
