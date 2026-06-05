import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { profile, type ProfileInsert, type ProfileRow } from "../schema/profile.ts";
import { touchTimestamps, writeHistory } from "./base.ts";

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
  async exists(): Promise<boolean> {
    return (await profileRepo.get()) !== undefined;
  },
};
