import { VaultBusyError } from "@fiscode/core";

/** The one lock and channel name for every tree change, scan, migration, export and restore. */
export const VAULT_LOCK = "fiscode-vault";

/** The part of `navigator.locks` used here (all four engines have it). */
export type LockManagerLike = {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
};

export type ChannelLike = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
  close(): void;
};

const defaultLocks = (): LockManagerLike | undefined =>
  (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;

/**
 * Runs `fn` under the `fiscode-vault` Web Lock (ADR § 11.9). A user action (the default) asks
 * with ifAvailable and throws VaultBusyError when another tab holds it; background work
 * (`wait: true`: a focus scan, journal recovery at boot) waits its turn. Where the browser has no
 * Web Locks (tests, the headless backup) there is only one holder, so `fn` just runs.
 */
export const withVaultLock = async <T>(
  fn: () => Promise<T>,
  options: { wait?: boolean; locks?: LockManagerLike } = {},
): Promise<T> => {
  const locks = options.locks ?? defaultLocks();
  if (!locks) return fn();
  return locks.request(VAULT_LOCK, options.wait ? {} : { ifAvailable: true }, async (lock) => {
    if (lock === null) throw new VaultBusyError();
    return fn();
  });
};

const defaultChannel = (): ChannelLike | undefined =>
  typeof BroadcastChannel === "undefined"
    ? undefined
    : // Its listeners get a MessageEvent, which has `data`; the DOM types only say Event.
      (new BroadcastChannel(VAULT_LOCK) as unknown as ChannelLike);

/** Tell other tabs a change finished, so they refresh their loaders. */
export const announceVaultChange = (open: () => ChannelLike | undefined = defaultChannel) => {
  const channel = open();
  if (!channel) return;
  channel.postMessage({ type: "changed" });
  channel.close();
};

/** Calls `onChange` when another tab finishes a change. Returns the unsubscribe. */
export const onVaultChange = (
  onChange: () => void,
  open: () => ChannelLike | undefined = defaultChannel,
): (() => void) => {
  const channel = open();
  if (!channel) return () => {};
  const listener = (e: { data: unknown }) => {
    if ((e.data as { type?: unknown } | null)?.type === "changed") onChange();
  };
  channel.addEventListener("message", listener);
  return () => {
    channel.removeEventListener("message", listener);
    channel.close();
  };
};
