import type { EntityType } from "@fiscode/core";
import { soleProprietorStrategy } from "./sole-prop.ts";
import { sCorpStrategy } from "./s-corp.ts";
import type { TaxStrategy } from "./types.ts";

export { soleProprietorStrategy, sCorpStrategy };
export type { TaxStrategy } from "./types.ts";
export { NotImplementedError } from "./types.ts";

export const strategyFor = (entity: EntityType): TaxStrategy => {
  switch (entity) {
    case "sole_prop":
    case "single_member_llc":
      return soleProprietorStrategy;
    case "s_corp":
      return sCorpStrategy;
  }
};
