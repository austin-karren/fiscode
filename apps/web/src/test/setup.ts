import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach } from "vitest";

// Sonner schedules setTimeout callbacks (a toast's auto-close, and the exit
// animation that even toast.dismiss() starts) that call React setState. One
// that fires after jsdom has torn down throws "window is not defined", an
// unhandled error that fails CI with every test passing (#71, #77). So every
// test ends with no toasts, nothing mounted, and no timer it started still
// pending.
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = realSetTimeout(
    (...cbArgs: unknown[]) => {
      pendingTimers.delete(id);
      if (typeof handler === "function") handler(...cbArgs);
    },
    timeout,
    ...args,
  );
  pendingTimers.add(id);
  return id;
}) as unknown as typeof setTimeout;
globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
  if (id !== undefined) pendingTimers.delete(id);
  realClearTimeout(id);
}) as typeof clearTimeout;

afterEach(() => {
  toast.dismiss();
  cleanup();
  for (const id of pendingTimers) realClearTimeout(id);
  pendingTimers.clear();
});
