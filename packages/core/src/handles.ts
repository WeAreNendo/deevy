import { member, type Db } from "@deevy/db";
import { like } from "drizzle-orm";

/**
 * A handle names one Member, so a mention like `@planner` resolves to exactly
 * one of them. Read in one statement rather than probing a suffix at a time,
 * since D1 charges per round trip (docs/plans/m1.md).
 */
export async function allocateHandle(db: Db, from: string): Promise<string> {
  const base = slugify(from.split("@")[0] ?? from);
  const prefix = `${base}%`;
  const members = await db
    .select({ handle: member.handle })
    .from(member)
    .where(like(member.handle, prefix));
  const taken = new Set(members.map((row) => row.handle));

  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}
