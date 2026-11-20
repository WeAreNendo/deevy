/**
 * Every operation an Agent may call, as a command you can type.
 *
 * `commandsFor` says what the operations are and `fieldsOf` says what their
 * inputs look like; this turns the pair into commander commands and dispatches
 * them through the typed client. No command is written by hand — the two that
 * are not operations live in main.ts.
 */
import { Command, Option } from "commander";
import { router } from "@deevy/core/router";
import { commandsFor, type CommandDescriptor } from "./commands.ts";
import { clientFor, explain, type DeevyClient } from "./client.ts";
import { credentialFor, noKey } from "./credentials.ts";
import { coerce, fieldsOf, flagNameFor, type Field } from "./flags.ts";

/** Required is not visible in commander's help unless the description says it. */
function describe(field: Field): string {
  const said = field.description ?? "";
  return field.required ? `${said}${said ? " " : ""}(required)` : said;
}
import { capabilitiesFor, missingFrom } from "./capabilities.ts";
import { plain, render, type Ink } from "./render.ts";

export interface Surroundings {
  /**
   * The deevy to talk to, path included. Resolved per invocation, so
   * `--deevy-url` can override the environment.
   */
  baseURL: string;
  /** This CLI's own version, for the message when the two disagree. */
  cliVersion?: string;
  /** Where the capabilities cache is kept; a test points it somewhere disposable. */
  dir?: string;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  out?: (line: string) => void;
  /** Colour, when somebody is looking at a terminal rather than a pipe. */
  ink?: Ink;
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
    const leaf = groupFor(root, command.words)
      .command(
        `${command.words.at(-1) ?? ""} ${command.parameters.map((p) => `<${p}>`).join(" ")}`.trim(),
      )
      .description(command.summary)
      // Every generated command can be pointed somewhere, because the error a
      // command gives without one used to tell people to pass a URL it had no
      // way to accept.
      .addOption(new Option("--deevy-url <url>", "the deevy to talk to; defaults to DEEVY_URL"))
      // Every command takes it, and today every command answers with it either
      // way: a shape worth reading is the slice after this one, and the flag is
      // the contract a script writes against in the meantime.
      .addOption(new Option("--json", "print the answer as JSON"));

    for (const field of fieldsOf(command.inputSchema)) {
      const option = optionFor(field, command);
      if (option) leaf.addOption(option);
    }

    leaf.action(async (...args: unknown[]) => {
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
  const credential = credentialFor(where.baseURL, where.environment ?? process.env);
  if (!credential) throw new Error(noKey(where.baseURL));

  // What this instance actually has. A CLI ships with deevy and knows the
  // operations of the tree it was built from, which is the wrong list the
  // moment it is pointed at an older instance — so the answer comes from the
  // instance, and a command it does not have is named rather than failing as a
  // 404 somebody has to interpret.
  const asking = {
    ...(where.fetchImpl ? { fetchImpl: where.fetchImpl } : {}),
    ...(where.dir ? { dir: where.dir } : {}),
  };
  // Not reachable, not a deevy, too slow: let the command through and let the
  // real call fail with its own error. Failing closed on a question nobody
  // asked would make this feature the thing that breaks the CLI.
  let capabilities = await capabilitiesFor(where.baseURL, asking).catch(() => null);
  if (capabilities && !capabilities.operations.includes(command.operation)) {
    // The cached answer is up to a day old, so the first thing to rule out is
    // that the instance gained the operation since. Otherwise upgrading an
    // instance would be met by a CLI telling you to upgrade the instance.
    capabilities = await capabilitiesFor(where.baseURL, { ...asking, refresh: true }).catch(
      () => capabilities,
    );
  }
  if (capabilities && !capabilities.operations.includes(command.operation)) {
    throw new Error(
      missingFrom(
        command.operation,
        command.words,
        where.baseURL,
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
    throw new Error(explain(error));
  });
  // `--json` is exact and is what a script reads; the shaped answer is for the
  // other reader, and is what you get by default.
  out(options.json === true ? JSON.stringify(answer, null, 2) : render(answer, where.ink ?? plain));
}
