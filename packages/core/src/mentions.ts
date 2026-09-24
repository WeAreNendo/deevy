import type { Db } from "@deevy/db";

/**
 * `@handle` tokens in a body. A handle is preceded by whitespace or the start
 * of the text, so an email address is not a mention. Duplicates are dropped and
 * order is kept, since the first mention is the one a reader sees first.
 */
export function extractHandles(body: string): string[] {
  const found = body.matchAll(/(?:^|[^\w@/])@([a-z0-9][a-z0-9-]{0,59})/gi);
  const handles: string[] = [];
  for (const match of found) {
    const handle = match[1]!.toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

/**
 * The Members a body mentions. One query: a handle is a Member's, and the Teams
 * that used to share the namespace are gone (ADR-0024).
 */
export async function resolveMentions(
  db: Db,
  workspaceId: string,
  body: string,
): Promise<string[]> {
  const handles = extractHandles(body);
  if (handles.length === 0) return [];
  const members = await db.query.member.findMany({
    where: { workspaceId, handle: { in: handles } },
    columns: { id: true },
  });
  return members.map((member) => member.id);
}
