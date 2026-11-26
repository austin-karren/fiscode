import { OperationCancelledError, VaultNameTakenError } from "@fiscode/core";

import { errorLine } from "./documents-view";

/** What a vault switch shows when it stops. Cancel is "Nothing changed", not a failure. */
export const vaultSwitchLine = (error: unknown): string => {
  if (error instanceof OperationCancelledError) return "Nothing changed.";
  if (error instanceof VaultNameTakenError) {
    return `${error.path}: pick an empty folder or move that file.`;
  }
  return errorLine(error);
};
