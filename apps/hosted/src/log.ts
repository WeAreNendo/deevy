import { describeError, withoutBoundValues, type AuthLogger } from "@deevy/core";

/**
 * What a hosted Workspace writes to deevy Cloud's logs: the Workspace it was,
 * and an error said the way `describeError` says one, so that a query that
 * failed while writing a row names its SQL and SQLite's reason and none of the
 * row (apps/docs/content/cloud/support.md, "What we can see of your
 * Workspace"). Everything in this Worker that logs an error goes through here:
 * the app's reporter, Better Auth's logger, a request the object could not
 * serve, an alarm that failed, and the one answer to the platform that runs a
 * query (`throwDescribed`). What Better Auth did not expect is handed back to
 * the app's reporter too (`rethrowUnexpected`), because better-call would log
 * it whole on a line of its own that no logger sees.
 */
export function reportFor(slug: string): (error: unknown) => void {
  return (error) => console.error(`[${slug}] ${describeError(error)}`);
}

/**
 * `failure` again, as an error that carries its description and nothing
 * else, for one this Worker throws across RPC: the platform hands it on to
 * the console, whose log is deevy Cloud's too.
 */
export function throwDescribed(failure: unknown): never {
  throw new Error(describeError(failure));
}

/**
 * Better Auth's log lines, held to the same rule. Its message is its own text
 * but for one line, where it logs a database error's message as the message,
 * so the values drizzle appended to that are cut; an error among the
 * arguments is described; any other argument is left out, because what is in
 * an object Better Auth hands its logger is not this Worker's to vouch for.
 */
export function betterAuthLogger(slug: string): AuthLogger {
  return {
    log(level, message, ...args: unknown[]) {
      const errors = args.filter((arg): arg is Error => arg instanceof Error).map(describeError);
      const line = [`[${slug}] [Better Auth] ${withoutBoundValues(message)}`, ...errors].join("\n");
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    },
  };
}
