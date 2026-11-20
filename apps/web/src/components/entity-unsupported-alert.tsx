import { CircleAlert } from "lucide-react";

import { ENTITY_TYPE_LABELS, labelFor } from "@fiscode/core";
import { Alert, AlertDescription, AlertTitle } from "@fiscode/ui/components/alert";
import type { DerivedYear } from "@fiscode/tax";

// The tax engine has sole-proprietor math only. When the year's entity is
// anything else, say so beside the numbers.
export function EntityUnsupportedAlert({
  derived,
}: {
  derived: Pick<DerivedYear, "entityType" | "entityUnsupported">;
}) {
  if (!derived.entityUnsupported) return null;
  return (
    <Alert variant="warning">
      <CircleAlert />
      <AlertTitle>Estimated as a sole proprietorship</AlertTitle>
      <AlertDescription>
        Your entity this year is {labelFor(ENTITY_TYPE_LABELS, derived.entityType)}. This estimate
        is computed as a sole proprietorship; S-corp is not supported yet.
      </AlertDescription>
    </Alert>
  );
}
