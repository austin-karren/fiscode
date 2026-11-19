import type { Cents, QuarterlyMethod } from "@fiscode/core";
import type {
  AnnualizedInput,
  QuarterlyPlan,
  TaxEstimate,
  TaxInput,
  YearConfig,
} from "../types.ts";

export interface TaxStrategy {
  readonly id: "sole_prop" | "s_corp";
  compute(input: TaxInput, cfg: YearConfig): TaxEstimate;
  quarterly(
    input: TaxInput | AnnualizedInput,
    cfg: YearConfig,
    method: QuarterlyMethod,
    /** Form 2210 line 9: the smaller of 90% of this year's tax and the prior-year amount. */
    requiredAnnualPayment: Cents,
  ): QuarterlyPlan;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
