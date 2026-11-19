import { EntityDatesError, EntityOverlapError } from "@fiscode/core";
import { describe, expect, it } from "vitest";

import { entityPeriodFieldError, periodErrorFor } from "./entity-period-error";

const FIXED = "2026-06-04T12:00:00.000Z";
const soleProp = {
  id: "ent_sole",
  type: "sole_prop",
  startDate: "2024-01-01",
  endDate: null,
  notes: null,
  deletedAt: null,
  createdAt: FIXED,
  updatedAt: FIXED,
};

describe("entityPeriodFieldError", () => {
  it("puts an overlap on the start date, with the repo's message", () => {
    const err = new EntityOverlapError(soleProp as never);
    expect(entityPeriodFieldError(err)).toEqual({ field: "startDate", message: err.message });
  });

  it("puts an end before the start on the end date", () => {
    const err = new EntityDatesError({ startDate: "2026-11-02", endDate: "2023-01-01" });
    expect(entityPeriodFieldError(err).field).toBe("endDate");
  });

  it("keeps the message while the saved periods are as they were when it was refused", () => {
    const periods = [soleProp];
    const error = entityPeriodFieldError(new EntityOverlapError(soleProp as never), periods);
    expect(periodErrorFor(error, "startDate", [{ ...soleProp }])).toBe(error.message);
  });

  it("drops the message once another period was ended or edited", () => {
    const error = entityPeriodFieldError(new EntityOverlapError(soleProp as never), [soleProp]);
    const ended = { ...soleProp, endDate: "2024-12-31" };
    expect(periodErrorFor(error, "startDate", [ended])).toBeUndefined();
  });

  it("drops the message once another period was deleted", () => {
    const error = entityPeriodFieldError(new EntityOverlapError(soleProp as never), [soleProp]);
    expect(periodErrorFor(error, "startDate", [])).toBeUndefined();
    const archived = { ...soleProp, deletedAt: FIXED };
    expect(periodErrorFor(error, "startDate", [archived])).toBeUndefined();
  });

  it("gives each field only its own message", () => {
    const error = { field: "endDate", message: "Demo message" } as const;
    expect(periodErrorFor(error, "endDate")).toBe("Demo message");
    expect(periodErrorFor(error, "startDate")).toBeUndefined();
    expect(periodErrorFor(null, "startDate")).toBeUndefined();
  });
});
