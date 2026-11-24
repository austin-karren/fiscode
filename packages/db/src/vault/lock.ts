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
  options: { wait?: boolean; long?: boolean; locks?: LockManagerLike } = {},
): Promise<T> => {
  const locks = options.locks ?? defaultLocks();
  if (!locks) return fn();
  return locks.request(VAULT_LOCK, options.wait ? {} : { ifAvailable: true }, async (lock) => {
    if (lock === null) throw new VaultBusyError();
    // Only a holder of VAULT_LOCK takes this one, so it is always free here.
    return options.long ? locks.request(VAULT_LONG_LOCK, {}, fn) : fn();
  });
};

/**
 * Held, inside VAULT_LOCK, by a long op: folder rename/move, migration, export, restore
 * (§ 11.3). A focus scan that finds it taken is skipped, not queued (§ 11.4).
 */
export const VAULT_LONG_LOCK = "fiscode-vault-long";

/**
 * Whether a long op runs in any tab right now. A probe: it takes and drops the lock at once, so
 * it never holds it while waiting for VAULT_LOCK (that order would deadlock with the op).
 */
export const isLongVaultOpRunning = async (locks = defaultLocks()): Promise<boolean> => {
  if (!locks) return false;
  return locks.request(VAULT_LONG_LOCK, { ifAvailable: true }, async (lock) => lock === null);
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
