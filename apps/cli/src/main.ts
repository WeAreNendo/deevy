/**
 * The CLI's entry.
 *
 * Five verbs are written here because the registry has nothing to generate them
 * from: signing in, signing out, saying who you are, putting a Gate in front of
 * a Human, and following the Event log. The last is an operation, but a
 * streaming one — every generated command awaits a value, and awaiting an async
 * generator as if it were one waits forever. Everything else a user can type is
 * generated (generate.ts), so an operation added to deevy is a command without
 * anybody writing one.
 */
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { addGeneratedCommands } from "./generate.ts";
import { inkFor } from "./render.ts";
import { openGate, signIn, signOut, whoAmI } from "./identity.ts";
import { watch } from "./watch.ts";
import { clientFor } from "./client.ts";
import { credentialFor } from "./credentials.ts";

/** Written by `vp pack` from package.json; see vite.config.ts. */
declare const __DEEVY_CLI_VERSION__: string | undefined;
const CLI_VERSION = typeof __DEEVY_CLI_VERSION__ === "string" ? __DEEVY_CLI_VERSION__ : "0.0.0-dev";

/**
 * Whether this module is the program being run.
 *
 * `import.meta.main` would say it in one word, but it needs Node 24.2 and this
 * package declares 22.18 — where it is `undefined`, which would make a
 * published CLI exit silently with status 0. Comparing paths works everywhere.
 */
function isEntry(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Where this invocation is pointed, and how it was told. */
export function originFrom(
  argument: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const given = argument ?? environment.DEEVY_URL;
  if (!given) {
    throw new Error(
      "No deevy named. Pass the instance URL, or set DEEVY_URL:\n" +
        "  deevy login https://deevy.example.com",
    );
  }
  // A bare host gets https, except on loopback: deevy's own dev instance is
  // http://localhost:3000, so the most likely first thing anybody types would
  // otherwise fail with a TLS error.
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(given);
  const url = new URL(given.includes("://") ? given : `${loopback ? "http" : "https"}://${given}`);
  // A trailing slash makes `${origin}/rpc` into `${origin}//rpc`, which some
  // proxies answer and some do not.
  return url.origin;
}

export function program(): Command {
  const cli = new Command();
  cli
    .name("deevy")
    .description("deevy from a terminal")
    .showHelpAfterError()
    // Replaced at pack time with this package's version, which is deevy's: one
    // number for the instance, the image and this
    // (docs/plans/commits-and-changelogs.md).
    .version(CLI_VERSION);

  cli
    .command("login")
    .argument("[url]", "the deevy to sign in to; defaults to DEEVY_URL")
    .description("Sign in as yourself, through a browser")
    .option("--no-browser", "print the URL instead of opening it")
    .action(async (url: string | undefined, options: { browser: boolean }) => {
      await signIn(originFrom(url), { openBrowser: options.browser });
    });

  cli
    .command("logout")
    .argument("[url]", "the deevy to forget; defaults to DEEVY_URL")
    .description("Forget the token stored for an instance")
    .action(async (url: string | undefined) => {
      await signOut(originFrom(url));
    });

  cli
    .command("whoami")
    .argument("[url]", "the deevy to ask; defaults to DEEVY_URL")
    .description("Say who this terminal is, and how it is authenticated")
    .option("--json", "print the answer as JSON")
    .action(async (url: string | undefined, options: { json?: boolean }) => {
      await whoAmI(originFrom(url), { json: options.json === true });
    });

  cli
    .command("gates")
    .description("Work with gates")
    .command("open")
    .argument("<issue-key>", "the Issue whose Gate wants a ruling, as in DEV-42")
    .argument("[url]", "the deevy it is in; defaults to DEEVY_URL")
    .description("Open a Gate where it can actually be ruled: in a browser")
    .option("--no-browser", "print the URL instead of opening it")
    .action(async (issueKey: string, url: string | undefined, options: { browser: boolean }) => {
      await openGate(originFrom(url), issueKey, { openBrowser: options.browser });
    });

  cli
    .command("events")
    .description("Work with events")
    .command("watch")
    .argument("[url]", "the deevy to follow; defaults to DEEVY_URL")
    .description("Follow the Event log as it happens")
    .option("--after <seq>", "resume from this Event")
    .option("--project-id <id>", "only this Project's Events")
    .option("--json", "print each Event as JSON")
    .action(
      async (
        url: string | undefined,
        options: { after?: string; projectId?: string; json?: boolean },
      ) => {
        const origin = originFrom(url);
        const credential = await credentialFor(origin);
        if (!credential) throw new Error(`Not signed in to ${origin}. Run \`deevy login\` first.`);
        // Ctrl-C ends the watch rather than the process mid-write.
        const stopping = new AbortController();
        process.on("SIGINT", () => {
          stopping.abort();
        });
        await watch(clientFor(credential), {
          ...(options.after ? { after: Number(options.after) } : {}),
          ...(options.projectId ? { projectId: options.projectId } : {}),
          json: options.json === true,
          ink: inkFor(),
          signal: stopping.signal,
        });
      },
    );

  // Everything else: one command per operation, from the registry.
  addGeneratedCommands(cli, (url) => ({
    origin: originFrom(url),
    cliVersion: CLI_VERSION,
    ink: inkFor(),
  }));

  return cli;
}

if (isEntry()) {
  try {
    await program().parseAsync(process.argv);
  } catch (error) {
    // A stack trace for a missing environment variable helps nobody, which is
    // the lesson apps/agent/src/main.ts already learned.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
