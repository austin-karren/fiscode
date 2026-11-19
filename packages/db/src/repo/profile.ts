import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { profile, type ProfileInsert, type ProfileRow } from "../schema/profile.ts";
import { changesNothing, touchTimestamps, writeHistory } from "./base.ts";

// Singleton profile keyed by the literal id 'profile'.
const PROFILE_ID = "profile";

export const profileRepo = {
  async get(): Promise<ProfileRow | undefined> {
    const db = getDb();
    const rows = (await db
      .select()
      .from(profile)
      .where(eq(profile.id, PROFILE_ID))
      .limit(1)) as ProfileRow[];
    return rows[0];
  },
  async upsert(input: Omit<ProfileInsert, "id" | "createdAt" | "updatedAt">): Promise<ProfileRow> {
    const db = getDb();
    const existing = await profileRepo.get();
    const now = new Date().toISOString();
    if (existing) {
      if (changesNothing(existing, input)) return existing;
      await db
        .update(profile)
        .set({ ...input, ...touchTimestamps() })
        .where(eq(profile.id, PROFILE_ID));
      const after = await profileRepo.get();
      await writeHistory("profile", PROFILE_ID, "update", existing, after);
      return after!;
    }
    await db.insert(profile).values({ id: PROFILE_ID, ...input, createdAt: now, updatedAt: now });
    const after = await profileRepo.get();
    await writeHistory("profile", PROFILE_ID, "insert", undefined, after);
    return after!;
  },
  /**
   * Put the profile back to `snapshot`, as the crud repos' `revertTo` does:
   * the snapshot is written whole (its `createdAt` included), `updatedAt` is
   * now, the row is inserted if there is none, and one `revert` history entry
   * records before and after. The id is always the singleton's. No profile
   * field has a cross-row rule, so nothing is checked first.
   */
  async revertTo(snapshot: ProfileRow): Promise<ProfileRow> {
    const db = getDb();
    const before = await profileRepo.get();
    const restored = { ...snapshot, id: PROFILE_ID, updatedAt: new Date().toISOString() };
    if (before) {
      await db.update(profile).set(restored).where(eq(profile.id, PROFILE_ID));
    } else {
      await db.insert(profile).values(restored);
    }
    const after = await profileRepo.get();
    await writeHistory("profile", PROFILE_ID, "revert", before, after);
    return after!;
  },
  async exists(): Promise<boolean> {
    return (await profileRepo.get()) !== undefined;
  },
};
