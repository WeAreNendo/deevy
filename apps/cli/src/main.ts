/**
 * The CLI's entry.
 *
 * Three verbs are written here because they are not operations — signing in,
 * signing out, and saying who you are. Everything else a user can type is
 * generated from the registry (generate.ts), so an operation added to deevy is
 * a command without anybody writing one.
 */
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { addGeneratedCommands } from "./generate.ts";
import { signIn, signOut, whoAmI } from "./identity.ts";

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

  // Everything else: one command per operation, from the registry.
  addGeneratedCommands(cli, (url) => ({ origin: originFrom(url), cliVersion: CLI_VERSION }));

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
