#!/usr/bin/env node
/**
 * The CLI's entry.
 *
 * Four verbs are written here because the registry has nothing to generate them
 * from: signing in, signing out, saying who you are, and following the Event
 * log. The last is an operation, but a streaming one — every generated command
 * awaits a value, and awaiting an async generator as if it were one waits
 * forever. Everything else a user can type is generated (generate.ts), so an
 * operation added to deevy is a command without anybody writing one.
 */
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { addGeneratedCommands } from "./generate.ts";
import { inkFor } from "./render.ts";
import { openGate } from "./gates.ts";
import { signIn, signOut, whoAmI } from "./identity.ts";
import { watch } from "./watch.ts";
import { clientFor, explain } from "./client.ts";
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

/**
 * Where the SPA is, which is not always where the API is.
 *
 * deevy already knows they can differ — `webURL` on the app, `DEEVY_WEB_ORIGIN`
 * on the instance — and its own link builder says a URL built on the API origin
 * "404s" in the dev loop, where the API is on 3000 and the SPA on 5173. A Gate
 * link that opens a 404 is worse than one that is not offered.
 */
export function webOriginFrom(
  given: string | undefined,
  apiUrl: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return originFrom(given ?? environment.DEEVY_WEB_URL ?? apiUrl, environment);
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

  // Ruling happens in deevy's own browser and nowhere else (ADR-0004,
  // ADR-0010), so the only verb here is `open`: the CLI's job is to find the
  // Gate and hand it over.
  cli
    .command("gates")
    .description("Work with Gates")
    .command("open")
    .argument("<gate>", "a Gate's id, or the tracker's key for the record waiting at one")
    .argument("[url]", "the deevy to open it on; defaults to DEEVY_URL")
    .description("Open a Gate's ruling screen in a browser")
    .option("--no-browser", "print the URL instead of opening it")
    .action(async (gate: string, url: string | undefined, options: { browser?: boolean }) => {
      const origin = originFrom(url);
      const credential = await credentialFor(origin);
      if (!credential) throw new Error(`Not signed in to ${origin}. Run \`deevy login\` first.`);
      await openGate(origin, gate, {
        client: clientFor(credential),
        openBrowser: options.browser,
      });
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
        // Checked here rather than sent: NaN reaches the server as a validation
        // failure, and a validation failure used to be retried forever.
        const after = options.after === undefined ? undefined : Number(options.after);
        if (after !== undefined && !Number.isInteger(after)) {
          throw new Error(
            `--after wants an Event's number, and "${options.after ?? ""}" is not one.`,
          );
        }
        const credential = await credentialFor(origin);
        if (!credential) throw new Error(`Not signed in to ${origin}. Run \`deevy login\` first.`);
        // Ctrl-C ends the watch rather than the process mid-write.
        const stopping = new AbortController();
        // `once`, so a second Ctrl-C gets Node's default behaviour back rather
        // than finding the default still overridden by a handler that has
        // already done its job.
        process.once("SIGINT", () => {
          stopping.abort();
          process.exitCode = 130;
        });
        await watch(clientFor(credential), {
          ...(after === undefined ? {} : { after }),
          explain: (error: unknown) => explain(error, credential),
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
