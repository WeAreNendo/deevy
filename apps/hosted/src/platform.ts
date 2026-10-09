import { WorkerEntrypoint } from "cloudflare:workers";
import { forget, isSlug, lookup, record, RESERVED_SLUGS, slugs } from "./directory.ts";
import { readHostedEnv, type HostedBindings } from "./env.ts";
import { workspaceStub } from "./router.ts";
import { workspaceSecret } from "./secrets.ts";
import type { WorkspacePatch, WorkspaceStatus } from "./workspace.ts";

/**
 * What the console may ask of the hosted Worker, and the only way it may ask
 * (docs/plans/hosted.md). A `WorkerEntrypoint` reached over a service binding,
 * never routed to a URL, so nothing on the internet can call it; and it is the
 * whole contract between the open-source Worker and the private console, which
 * never imports deevy's packages (ADR-0028).
 */
export class Platform extends WorkerEntrypoint<HostedBindings> {
  #env = readHostedEnv(this.env);

  /** Whether a slug can be a new Workspace's, and why not when it cannot. */
  async available(slug: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!isSlug(slug)) {
      return {
        ok: false,
        reason:
          "A Workspace's address is 3 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
      };
    }
    if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "That address is reserved." };
    if (await this.env.DIRECTORY.get(`slug:${slug}`)) {
      return { ok: false, reason: "That address is taken." };
    }
    return { ok: true };
  }

  /**
   * A new Workspace at `/<slug>`. Its object is created in the platform's
   * jurisdiction, migrated, and told who it is; then the directory says it
   * exists, and only then does the router send anybody there. The first
   * verified sign-in with `adminEmail` becomes its admin, as on any deevy.
   */
  async provision(input: {
    slug: string;
    name: string;
    adminEmail: string;
  }): Promise<{ key: string; url: string }> {
    const free = await this.available(input.slug);
    if (!free.ok) throw new Error(free.reason);
    const key = newKey();
    const status = await workspaceStub(this.env, this.#env, key).provision({
      key,
      slug: input.slug,
      name: input.name.trim() || input.slug,
      adminEmail: input.adminEmail.trim().toLowerCase(),
    });
    if (status.migrations.error) {
      throw new Error(`The Workspace could not be migrated: ${status.migrations.error.message}`);
    }
    await record(this.env.DIRECTORY, input.slug, { key, status: "active" });
    return { key, url: `${this.#env.origin}/${input.slug}` };
  }

  /** What a Workspace says about itself: version, migrations, limits, counts. */
  async status(slug: string): Promise<WorkspaceStatus | null> {
    const entry = await lookup(this.env.DIRECTORY, slug);
    if (!entry) return null;
    // RPC types a returned empty tuple as `never[]`; the value is the same.
    return (await workspaceStub(this.env, this.#env, entry.key).status()) as WorkspaceStatus;
  }

  /**
   * Changes what a Workspace was provisioned with: its name, or its limits
   * over the platform's (`{ limits: { invitationsPerDay: 5 } }`; null gives a
   * limit back to the platform). A plan, once there are plans, is limits set
   * here. Suspending is `suspend`, which the directory has to know about too.
   */
  async configure(slug: string, patch: Omit<WorkspacePatch, "status">): Promise<WorkspaceStatus> {
    const stub = await this.#stub(slug);
    const name = patch.name?.trim();
    await stub.configure({
      ...(name ? { name } : {}),
      ...(patch.limits ? { limits: patch.limits } : {}),
    });
    return (await stub.status()) as WorkspaceStatus;
  }

  async suspend(slug: string): Promise<void> {
    await this.#setStatus(slug, "suspended");
  }

  async resume(slug: string): Promise<void> {
    await this.#setStatus(slug, "active");
  }

  /** A Workspace's database as SQL, for a backup or a team taking it home. */
  async dump(slug: string): Promise<string> {
    return (await this.#stub(slug)).dump();
  }

  /**
   * The two secrets a Workspace's data needs once it leaves: the one its
   * sessions are signed with and the one its Sockets' credentials are sealed
   * under. Handed to its owner with a dump, never stored anywhere.
   */
  async secrets(slug: string): Promise<{ betterAuthSecret: string; deevySecret: string }> {
    const entry = await lookup(this.env.DIRECTORY, slug);
    if (!entry) throw new Error(`No Workspace at /${slug}`);
    return {
      betterAuthSecret: await workspaceSecret(this.#env.masterSecret, entry.key, "auth"),
      deevySecret: await workspaceSecret(this.#env.masterSecret, entry.key, "seal"),
    };
  }

  /** The Workspace as it was at `at` (ms since the epoch), within the last 30 days. */
  async restore(slug: string, at: number): Promise<void> {
    await (await this.#stub(slug)).restore(at);
  }

  /**
   * Everything a Workspace holds, gone: the object's storage and its alarm,
   * then the directory entry. The console takes a final dump first and keeps
   * the grace period; this is the end of it.
   */
  async destroy(slug: string): Promise<void> {
    await (await this.#stub(slug)).destroy();
    await forget(this.env.DIRECTORY, slug);
  }

  /** Every Workspace's slug, for a deploy that asks each one for its status. */
  async list(): Promise<string[]> {
    return slugs(this.env.DIRECTORY);
  }

  async #stub(slug: string) {
    const entry = await lookup(this.env.DIRECTORY, slug);
    if (!entry) throw new Error(`No Workspace at /${slug}`);
    return workspaceStub(this.env, this.#env, entry.key);
  }

  async #setStatus(slug: string, status: "active" | "suspended"): Promise<void> {
    const entry = await lookup(this.env.DIRECTORY, slug);
    if (!entry) throw new Error(`No Workspace at /${slug}`);
    await workspaceStub(this.env, this.#env, entry.key).configure({ status });
    await record(this.env.DIRECTORY, slug, { ...entry, status });
  }
}

/** An object's name: random, never derived from anything a person chose. */
function newKey(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let key = "wsk_";
  for (const byte of bytes) key += alphabet[byte % alphabet.length];
  return key;
}
