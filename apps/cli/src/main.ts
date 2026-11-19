#!/usr/bin/env node
/**
 * The CLI's entry.
 *
 * It acts as the Agent whose key is in `DEEVY_API_KEY`, and as nobody else
 * (ADR-0035). Two verbs are written here because the registry has nothing to
 * generate them from: saying who you are, and putting a Gate in front of a
 * Human. Everything else a user can type is generated (generate.ts), so an
 * operation an Agent may call is a command without anybody writing one.
 */
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { basePathOf } from "@deevy/core";
import { addGeneratedCommands } from "./generate.ts";
import { inkFor } from "./render.ts";
import { openGate } from "./gates.ts";
import { whoAmI } from "./identity.ts";
import { clientFor } from "./client.ts";
import { credentialFor, noKey } from "./credentials.ts";

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

/**
 * Where this invocation is pointed, and how it was told: the whole URL of the
 * deevy, path included, with no trailing slash.
 *
 * A deployment may live under a path — a hosted Workspace at
 * `https://app.deevy.dev/acme`, or a deevy an operator serves at
 * `company.com/deevy` — and everything it answers is under that path (ADR-0029).
 * Reducing what was typed to its origin would point every command at the root
 * of the host, which is somebody else's deevy or nobody's.
 */
export function baseURLFrom(
  argument: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const given = argument ?? environment.DEEVY_URL;
  if (!given) {
    throw new Error(
      "No deevy named. Pass the instance URL, or set DEEVY_URL:\n" +
        "  deevy whoami https://deevy.example.com",
    );
  }
  // A bare host gets https, except on loopback: deevy's own dev instance is
  // http://localhost:3000, so the most likely first thing anybody types would
  // otherwise fail with a TLS error.
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(given);
  const url = new URL(given.includes("://") ? given : `${loopback ? "http" : "https"}://${given}`);
  // A trailing slash makes `${base}/rpc` into `${base}//rpc`, which some
  // proxies answer and some do not. A query or a fragment is not part of where
  // a deevy lives, so neither survives either.
  return `${url.origin}${basePathOf(url.href)}`;
}

/**
 * Where the SPA is, which is not always where the API is.
 *
 * deevy already knows they can differ — `webURL` on the app, `DEEVY_WEB_ORIGIN`
 * on the instance — and its own link builder says a URL built on the API origin
 * "404s" in the dev loop, where the API is on 3000 and the SPA on 5173. A Gate
 * link that opens a 404 is worse than one that is not offered.
 */
export function webURLFrom(
  given: string | undefined,
  apiURL: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return baseURLFrom(given ?? environment.DEEVY_WEB_URL ?? apiURL, environment);
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
    .command("whoami")
    .argument("[url]", "the deevy to ask; defaults to DEEVY_URL")
    .description("Say which Agent this terminal is")
    .option("--json", "print the answer as JSON")
    .action(async (url: string | undefined, options: { json?: boolean }) => {
      await whoAmI(baseURLFrom(url), { json: options.json === true });
    });

  // Ruling happens where a Human is — deevy's own page, the tracker or the
  // chat channel — and never with a key (ADR-0010), so the only verb here is
  // `open`: the CLI's job is to find the Gate and hand it over.
  cli
    .command("gates")
    .description("Work with Gates")
    .command("open")
    .argument("<gate>", "a Gate's id, or the tracker's key for the record waiting at one")
    .argument("[url]", "the deevy to open it on; defaults to DEEVY_URL")
    .description("Open a Gate's ruling screen in a browser")
    .option("--no-browser", "print the URL instead of opening it")
    .action(async (gate: string, url: string | undefined, options: { browser?: boolean }) => {
      const baseURL = baseURLFrom(url);
      const credential = credentialFor(baseURL);
      if (!credential) throw new Error(noKey(baseURL));
      await openGate(baseURL, gate, {
        client: clientFor(credential),
        // DEEVY_WEB_URL, when the SPA is not where the API is.
        webURL: webURLFrom(undefined, baseURL),
        openBrowser: options.browser,
      });
    });

  // Everything else: one command per operation, from the registry.
  addGeneratedCommands(cli, (url) => ({
    baseURL: baseURLFrom(url),
    cliVersion: CLI_VERSION,
    ink: inkFor(),
  }));

  return cli;
}

if (isEntry()) {
  try {
    await program().parseAsync(process.argv);
  } catch (error) {
    // A stack trace for a missing environment variable helps nobody.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
