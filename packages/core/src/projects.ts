import { project as projectTable, type Db, type Project } from "@deevy/db";
import type { Scope } from "./sockets/port.ts";
import { newId } from "./ids.ts";

/**
 * A Project is a binding to the Sockets its work lives in (ADR-0024). It has
 * no key, no Issue numbering and no Workflow: what it holds is where the
 * records come from, where the code is, who works it, and how much deevy says
 * back.
 */

/** The URL handle. Lowercase, hyphenated, derived from the container it binds. */
export const ProjectSlugPattern = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export interface ProjectBinding {
  trackerSocketId: string;
  trackerScope: Scope;
  trackerScopeKey: string;
  forgeSocketId?: string | null;
  forgeScope?: Scope | null;
  docsSocketId?: string | null;
  docsScope?: Scope | null;
}

export interface CreateProjectInput extends ProjectBinding {
  workspaceId: string;
  slug: string;
  name: string;
  description?: string | null;
  defaultAgentMemberId?: string | null;
}

/** Inserts the Project. One statement: there is no Workflow to seed beside it. */
export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
  const [row] = await db
    .insert(projectTable)
    .values({
      id: newId("project"),
      workspaceId: input.workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      trackerSocketId: input.trackerSocketId,
      trackerScope: input.trackerScope,
      trackerScopeKey: input.trackerScopeKey,
      forgeSocketId: input.forgeSocketId ?? null,
      forgeScope: input.forgeScope ?? null,
      docsSocketId: input.docsSocketId ?? null,
      docsScope: input.docsScope ?? null,
      defaultAgentMemberId: input.defaultAgentMemberId ?? null,
    })
    .returning();
  if (!row) throw new Error("createProject: the insert returned no row");
  return row;
}
