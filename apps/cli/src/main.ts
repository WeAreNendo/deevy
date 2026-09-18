/**
 * The CLI's entry.
 *
 * Slice 2 carries the three verbs that are not operations — signing in, signing
 * out, and saying who you are. The ninety-four that are operations arrive in
 * the next slice, generated from the registry by `commandsFor`.
 */
import { Command } from "commander";
import { signIn, signOut, whoAmI } from "./identity.ts";

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
  const url = new URL(given.includes("://") ? given : `https://${given}`);
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
    // The version is the package's, which is deevy's: one number for the
    // instance, the image and this (docs/plans/commits-and-changelogs.md).
    .version(process.env.DEEVY_CLI_VERSION ?? "0.0.0-dev");

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

  return cli;
}

if (import.meta.main) {
  try {
    await program().parseAsync(process.argv);
  } catch (error) {
    // A stack trace for a missing environment variable helps nobody, which is
    // the lesson apps/agent/src/main.ts already learned.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
