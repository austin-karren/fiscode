import type { QuarterlyMethod } from "@fiscode/core";
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
  ): QuarterlyPlan;
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
