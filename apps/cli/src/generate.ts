/**
 * Every operation, as a command you can type.
 *
 * `commandsFor` says what the operations are and `fieldsOf` says what their
 * inputs look like; this turns the pair into commander commands and dispatches
 * them through the typed client. No command is written by hand — the four that
 * are not operations live in main.ts, and there are four of them
 * (docs/plans/cli.md).
 */
import { Command, Option } from "commander";
import { router } from "@deevy/core/router";
import { commandsFor, type CommandDescriptor } from "./commands.ts";
import { clientFor, explain, type DeevyClient } from "./client.ts";
import { coerce, fieldsOf, flagNameFor, type Field } from "./flags.ts";

/** Required is not visible in commander's help unless the description says it. */
function describe(field: Field): string {
  const said = field.description ?? "";
  return field.required ? `${said}${said ? " " : ""}(required)` : said;
}
import { credentialFor, type Credential } from "./credentials.ts";
import { capabilitiesFor, missingFrom } from "./capabilities.ts";

export interface Surroundings {
  /** Resolved per invocation, so `--deevy-url` can override the environment. */
  origin: string;
  /** This CLI's own version, for the message when the two disagree. */
  cliVersion?: string;
  /** Where tokens are kept; a test points it somewhere disposable. */
  dir?: string;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
}

/**
 * The refusal for the four operations that want a cookie session.
 *
 * They stay in the command list rather than being dropped, because a command
 * that is missing teaches nothing and a command that explains itself teaches
 * the rule. Two different rules sit behind the one flag, so the message says
 * which (ADR-0004, ADR-0010).
 */
export function sessionOnlyRefusal(command: CommandDescriptor): string {
  const said = command.words.join(" ");
  if (command.operation.startsWith("gates.")) {
    return `${said} is a Gate ruling, and a Gate is ruled by a Human in a browser — never by a CLI, an API key or an Agent, whatever it is signed in as (ADR-0004, ADR-0010).\nOpen the Issue in deevy and rule it there.`;
  }
  if (command.operation.startsWith("oauthClients.")) {
    return `${said} needs a Human signed in to deevy itself. A delegated credential cannot list or revoke the consents that delegated it, so this one lives in deevy's own Settings.`;
  }
  // A third reason nobody has written down yet: say the rule rather than
  // assert one of the two above and be confidently wrong.
  return `${said} needs a Human signed in to deevy itself, in a browser. No CLI credential satisfies it.`;
}

/** The flag commander should carry for a field, or nothing for a positional. */
function optionFor(field: Field, command: CommandDescriptor): Option | null {
  if (command.parameters.includes(field.name)) return null;
  const flag = flagNameFor(field.name);
  // A boolean takes an optional value rather than being a bare switch. A bare
  // one can only ever send true, and `webhooks update --disabled` is the
  // operation whose whole point is that false switches a webhook back on.
  const placeholder =
    field.kind === "array"
      ? `<${field.element ?? "value"}...>`
      : field.kind === "boolean"
        ? "[boolean]"
        : `<${field.kind}>`;
  const option = new Option(`${flag} ${placeholder}`, describe(field));
  if (field.choices) option.choices(field.choices);
  if (field.kind === "boolean") option.choices(["true", "false"]);
  // An array field is one flag given more than once, which is what every other
  // CLI does and what avoids inventing a separator that a value might contain.
  if (field.kind === "array") {
    option.argParser((value: string, previous: string[] | undefined) => [
      ...(previous ?? []),
      value,
    ]);
  }
  if (field.required) option.makeOptionMandatory();
  // commander camelCases a flag back into a property name, and `inputFor` reads
  // the field name — so a name those two disagree about is a value collected
  // from the user and then silently dropped. `webhookURL` is the shape that
  // does it. Nothing in the router does today, and this is why it stays that way.
  if (option.attributeName() !== field.name) {
    throw new Error(
      `commandsFor: --${option.attributeName()} would not carry "${field.name}" back; ` +
        `the flag name and the field name have to agree`,
    );
  }
  if (field.name === "json") {
    throw new Error(`commandsFor: "${command.operation}" has a json field, which --json shadows`);
  }
  return option;
}

/** Positionals first, then flags, then whatever `--json` was asked for. */
export function inputFor(
  command: CommandDescriptor,
  positionals: string[],
  options: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  command.parameters.forEach((name, index) => {
    const given = positionals[index];
    if (given !== undefined) input[name] = given;
  });
  for (const field of fieldsOf(command.inputSchema)) {
    if (command.parameters.includes(field.name)) continue;
    // commander camelCases a flag back into the name it came from, which is the
    // field name, so no second mapping is needed here.
    const raw = options[field.name];
    if (raw === undefined) continue;
    input[field.name] = coerce(raw as string | string[] | boolean, field);
  }
  return input;
}

/** Reaches into the client by the operation's dotted name. */
async function call(
  client: DeevyClient,
  operation: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const procedure = operation
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], client);
  return (procedure as (input: unknown) => Promise<unknown>)(input);
}

/**
 * The groups a command line reads as: `deevy issues list` is the `issues`
 * group and the `list` command in it, however deep the registry nests.
 */
function groupFor(root: Command, words: string[]): Command {
  let node = root;
  for (const word of words.slice(0, -1)) {
    const found = node.commands.find((child) => child.name() === word);
    node = found ?? node.command(word).description(`Work with ${word}`);
  }
  return node;
}

export function addGeneratedCommands(
  root: Command,
  surroundings: (url?: string) => Surroundings,
): Command {
  for (const command of commandsFor(router)) {
    // The Event stream is a command in its own slice: awaiting an async
    // generator as if it were a value waits forever.
    if (command.streaming) continue;

    const leaf = groupFor(root, command.words)
      .command(
        `${command.words.at(-1) ?? ""} ${command.parameters.map((p) => `<${p}>`).join(" ")}`.trim(),
      )
      .description(command.summary)
      // Every generated command can be pointed somewhere, because the error a
      // command gives without one used to tell people to pass a URL it had no
      // way to accept.
      .addOption(new Option("--deevy-url <origin>", "the deevy to talk to; defaults to DEEVY_URL"))
      // Every command takes it, and today every command answers with it either
      // way: a shape worth reading is the slice after this one, and the flag is
      // the contract a script writes against in the meantime.
      .addOption(new Option("--json", "print the answer as JSON"));

    for (const field of fieldsOf(command.inputSchema)) {
      const option = optionFor(field, command);
      if (option) leaf.addOption(option);
    }

    leaf.action(async (...args: unknown[]) => {
      // Before anything else, and before an instance is even named: that this
      // wants a Human in a browser is a fact about the operation, not about
      // where it would have been sent.
      if (command.sessionOnly) throw new Error(sessionOnlyRefusal(command));
      const options = args[command.parameters.length] as Record<string, unknown>;
      const positionals = args.slice(0, command.parameters.length) as string[];
      await run(
        command,
        positionals,
        options,
        surroundings(options.deevyUrl as string | undefined),
      );
    });
  }
  return root;
}

async function run(
  command: CommandDescriptor,
  positionals: string[],
  options: Record<string, unknown>,
  where: Surroundings,
): Promise<void> {
  const out =
    where.out ??
    ((line: string) => {
      console.log(line);
    });
  const credential = await credentialFor(where.origin, where.environment ?? process.env, where.dir);
  if (!credential) {
    throw new Error(`Not signed in to ${where.origin}. Run \`deevy login\` first.`);
  }
  refuseEarly(command, credential);

  // What this instance actually has. A CLI ships with deevy and knows the
  // operations of the tree it was built from, which is the wrong list the
  // moment it is pointed at an older instance — so the answer comes from the
  // instance, and a command it does not have is named rather than failing as a
  // 404 somebody has to interpret.
  const capabilities = await capabilitiesFor(where.origin, {
    ...(where.fetchImpl ? { fetchImpl: where.fetchImpl } : {}),
    ...(where.dir ? { dir: where.dir } : {}),
  }).catch(() => null);
  if (capabilities && !capabilities.operations.includes(command.operation)) {
    throw new Error(
      missingFrom(
        command.operation,
        command.words,
        where.origin,
        capabilities,
        where.cliVersion ?? "this build",
      ),
    );
  }

  const client = clientFor(credential, where.fetchImpl ?? fetch);
  const answer = await call(
    client,
    command.operation,
    inputFor(command, positionals, options),
  ).catch((error: unknown) => {
    throw new Error(explain(error, credential));
  });
  out(JSON.stringify(answer, null, 2));
}

/**
 * What the CLI knows before it asks.
 *
 * The registry says which operations only an Agent may call, and which an Agent
 * may not — so a refusal that is certain is given here, with the reason, rather
 * than fetched from the server as a bare FORBIDDEN.
 */
function refuseEarly(command: CommandDescriptor, credential: Credential): void {
  const asAgent = credential.kind === "key";
  // `public` short-circuits the server's own check before it looks at who is
  // asking (registry.ts), so `health ping` is answered for anybody — including
  // the version handshake a CLI holding only an Agent's key has to make.
  if (asAgent && command.auth !== "public" && !command.agents) {
    throw new Error(
      `${command.words.join(" ")} is not something an Agent may do, and DEEVY_API_KEY is set, so the CLI is an Agent.\nUnset it to act as the Human you signed in as.`,
    );
  }
  if (!asAgent && command.agentsOnly) {
    throw new Error(
      `${command.words.join(" ")} is one side of a Run, so only an Agent may call it. Set DEEVY_API_KEY to that Agent's key.`,
    );
  }
}
