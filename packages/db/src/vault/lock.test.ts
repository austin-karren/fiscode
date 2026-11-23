import { VaultBusyError } from "@fiscode/core";
import { describe, expect, it } from "vitest";
import {
  announceVaultChange,
  onVaultChange,
  VAULT_LOCK,
  withVaultLock,
  type ChannelLike,
  type LockManagerLike,
} from "./lock.ts";

/** One exclusive lock per name, as navigator.locks gives across tabs. */
const fakeLocks = (): LockManagerLike => {
  const held = new Map<string, Promise<unknown>>();
  return {
    async request(name, options, callback) {
      while (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        await held.get(name);
      }
      const p = callback({ name });
      held.set(
        name,
        p.catch(() => {}),
      );
      try {
        return await p;
      } finally {
        held.delete(name);
      }
    },
  };
};

describe("withVaultLock", () => {
  it("throws VaultBusyError for a user action while another holder runs", async () => {
    const locks = fakeLocks();
    let release!: () => void;
    const first = withVaultLock(() => new Promise<void>((r) => (release = r)), { locks });
    const second = withVaultLock(async () => "ran", { locks });
    await expect(second).rejects.toBeInstanceOf(VaultBusyError);
    await expect(second).rejects.toThrow("Busy in another tab. Try again when it finishes.");
    release();
    await first;
    expect(await withVaultLock(async () => "ran", { locks })).toBe("ran");
  });

  it("makes background work wait its turn", async () => {
    const locks = fakeLocks();
    const order: string[] = [];
    let release!: () => void;
    const first = withVaultLock(
      async () => {
        await new Promise<void>((r) => (release = r));
        order.push("first");
      },
      { locks },
    );
    const second = withVaultLock(async () => void order.push("second"), { locks, wait: true });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("just runs where there are no Web Locks", async () => {
    expect(await withVaultLock(async () => 1)).toBe(1);
  });
});

describe("the fiscode-vault channel", () => {
  it("tells other tabs a change finished", async () => {
    const bus = new Set<(e: { data: unknown }) => void>();
    const names: string[] = [];
    const open = (): ChannelLike => {
      const mine = new Set<(e: { data: unknown }) => void>();
      names.push(VAULT_LOCK);
      return {
        postMessage: (data) => bus.forEach((l) => (mine.has(l) ? undefined : l({ data }))),
        addEventListener: (_t, l) => (bus.add(l), mine.add(l)),
        removeEventListener: (_t, l) => (bus.delete(l), mine.delete(l)),
        close: () => {},
      };
    };
    let seen = 0;
    const stop = onVaultChange(() => seen++, open);
    announceVaultChange(open);
    expect(seen).toBe(1);
    stop();
    announceVaultChange(open);
    expect(seen).toBe(1);
  });
});
