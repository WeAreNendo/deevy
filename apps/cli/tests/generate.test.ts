import { rm } from "node:fs/promises";
import { Command } from "commander";
import { router } from "@deevy/core/router";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { commandsFor } from "../src/commands.ts";
import { coerce, fieldsOf, flagNameFor } from "../src/flags.ts";
import { addGeneratedCommands, inputFor, sessionOnlyRefusal } from "../src/generate.ts";
import { writeToken } from "../src/credentials.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiToken, baseURL, humanMember, testDeevy } from "./helpers.ts";

const commands = commandsFor(router);
const byOperation = new Map(commands.map((command) => [command.operation, command]));
const closers: (() => void)[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

function built(): Command {
  const root = new Command().name("deevy").exitOverride();
  return addGeneratedCommands(root, () => ({ origin: "http://localhost:3000" }));
}

describe("what the registry turns into", () => {
  it("gives every operation a command, except the one that streams", () => {
    const root = built();
    const found: string[] = [];
    const walk = (node: Command, prefix: string[]) => {
      for (const child of node.commands) {
        const words = [...prefix, child.name()];
        if (child.commands.length > 0) walk(child, words);
        else found.push(words.join(" "));
      }
    };
    walk(root, []);
    const expected = commands
      .filter((command) => !command.streaming)
      .map((command) => command.words.join(" "));
    // Equality both ways: a subset check would pass an extra command nobody
    // meant to generate as happily as the right set.
    expect(found.filter((one) => one !== "help").sort()).toEqual([...expected].sort());
    // And the stream is genuinely absent rather than merely unasserted.
    expect(found).not.toContain("events subscribe");
  });

  it("reads every input schema in the router, and names what it cannot explain", () => {
    // A field the generator cannot name is one a user has to hand-write JSON
    // for, and an array *of* json counts — the first version of this test
    // looked only at the field's own kind and reported one. A binding and a
    // Socket's configuration are both shapes a provider decides, so they are
    // written down here rather than flattened into flags nobody could guess.
    const opaque = commands
      .filter((command) => !command.streaming)
      .flatMap((command) =>
        fieldsOf(command.inputSchema)
          .filter((field) => field.kind === "json" || field.element === "json")
          .map((field) => `${command.operation}.${field.name}`),
      );
    expect(opaque.sort()).toEqual([
      "preferences.set.preferences",
      "projects.create.docs",
      "projects.create.forge",
      "projects.create.tracker",
      "routing.set.rules",
      "runs.postActivity.payload",
      "sockets.connect.config",
    ]);
  });

  it("gives every flag a name that carries its value back", () => {
    // The guard in optionFor, exercised over the whole router: commander
    // camelCases a flag into a property name and inputFor reads the field name,
    // so a disagreement is a value collected and then dropped.
    expect(() => built()).not.toThrow();
  });

  it("lets a boolean be said either way", () => {
    // `webhooks update --disabled false` is how a webhook is switched back on,
    // and a bare switch could only ever have said true.
    const update = built()
      .commands.find((c) => c.name() === "webhooks")
      ?.commands.find((c) => c.name() === "update");
    const disabled = (update?.options ?? []).find((option) => option.long === "--disabled");
    expect(disabled?.argChoices).toEqual(["true", "false"]);
    expect(disabled?.required).toBe(false);
  });

  it("makes a flag out of every field that is not a positional", () => {
    const create = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "create");
    const flags = (create?.options ?? []).map((option) => option.long);
    expect(flags).toContain("--project-slug");
    expect(flags).toContain("--assign-agent");
    expect(flags).toContain("--json");
  });

  it("takes the path parameters as positionals, not as flags", () => {
    const get = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "get");
    expect(get?.usage()).toContain("<issue>");
    expect((get?.options ?? []).map((o) => o.long)).not.toContain("--issue");
  });

  it("offers an enum's members, so --help says what is accepted", () => {
    const list = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "list");
    const kind = (list?.options ?? []).find((option) => option.long === "--assignee-kind");
    expect(kind?.argChoices).toEqual(["human", "agent"]);
  });
});

describe("a flag's name and its value", () => {
  it("hyphenates the field name", () => {
    expect(flagNameFor("assigneeMemberId")).toBe("--assignee-member-id");
    expect(flagNameFor("q")).toBe("--q");
  });

  it("turns argv into what the schema wants", () => {
    const number = { name: "limit", kind: "number" as const, required: false };
    expect(coerce("50", number)).toBe(50);
    // Not clever: something that is not a number is handed to zod as it came,
    // because zod's complaint about it is better than one invented here.
    expect(coerce("many", number)).toBe("many");
    const flag = { name: "open", kind: "boolean" as const, required: false };
    expect(coerce(true, flag)).toBe(true);
    const list = {
      name: "labelIds",
      kind: "array" as const,
      element: "string" as const,
      required: false,
    };
    expect(coerce(["a", "b"], list)).toEqual(["a", "b"]);
  });

  it("leaves a string that looks like a number alone", () => {
    // An Issue titled "42" is a title, not a number.
    expect(coerce("42", { name: "title", kind: "string", required: true })).toBe("42");
  });
});

describe("the input an operation is called with", () => {
  it("puts positionals under the names the path gave them", () => {
    const comment = byOperation.get("comments.create");
    expect(comment).toBeDefined();
    // The record is named by one string, which is an id, a URL or the key the
    // tracker wrote (ADR-0024).
    expect(inputFor(comment!, ["acme/deevy#42"], { body: "Looks right" })).toEqual({
      issue: "acme/deevy#42",
      body: "Looks right",
    });
  });

  it("leaves out what was not given, so a default in the schema still applies", () => {
    const list = byOperation.get("issues.list");
    expect(inputFor(list!, [], {})).toEqual({});
  });
});

describe("the ones the CLI cannot do", () => {
  // Ruling on a Gate is the other reason a command is refused before it is
  // sent, and it has no operation to be refused on until a Gate is a request
  // on a Run (docs/plans/sockets.md, slice 2).
  it("gives the consents their own reason, which is not the Gate one", () => {
    const revoke = byOperation.get("oauthClients.revoke");
    const said = sessionOnlyRefusal(revoke!);
    expect(said).toContain("cannot list or revoke the consents that delegated it");
    expect(said).not.toContain("Gate");
  });
});

describe("a generated command against a real deevy", () => {
  /**
   * The claim the whole slice rests on: a command nobody wrote, built from the
   * registry, reaching a real instance over the real transport with a real
   * token, and coming back with the thing it asked for.
   */
  it("creates an Issue, and lists it back", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await mkdtemp(join(tmpdir(), "deevy-cli-gen-"));
    scratch.push(dir);
    await writeToken(baseURL, await apiToken(deevy, "u1"), dir);

    const said: string[] = [];
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      origin: baseURL,
      dir,
      environment: {},
      fetchImpl: deevy.fetch,
      out: (line) => said.push(line),
    }));

    // The Project comes from a generated command too, which is one more thing
    // nobody wrote working against the real thing.
    // `--json` because this asserts on the exact answer, which is what the
    // flag is for; the shaped output is the default and is tested in render.
    await root.parseAsync(["projects", "create", "--key", "DEV", "--name", "Dev", "--json"], {
      from: "user",
    });

    await root.parseAsync(
      ["issues", "create", "--project-key", "DEV", "--title", "Something to do", "--json"],
      { from: "user" },
    );
    const created = JSON.parse(said.at(-1) ?? "{}") as { key: string; title: string };
    expect(created.title).toBe("Something to do");
    expect(created.key).toMatch(/^DEV-\d+$/);

    await root.parseAsync(["issues", "list", "--project-key", "DEV", "--json"], { from: "user" });
    const listed = JSON.parse(said.at(-1) ?? "{}") as { issues: { key: string }[] };
    expect(listed.issues.map((issue) => issue.key)).toContain(created.key);
  });

  it("hands back what zod actually said, not 'Input validation failed'", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await mkdtemp(join(tmpdir(), "deevy-cli-bad-"));
    scratch.push(dir);
    await writeToken(baseURL, await apiToken(deevy, "u1"), dir);

    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      origin: baseURL,
      dir,
      environment: {},
      fetchImpl: deevy.fetch,
      out: () => {},
    }));

    // A lowercase Project key. oRPC's own message is "Input validation failed";
    // the sentence worth reading is the one the schema wrote, and it only
    // arrives if `explain` digs it out of data.issues.
    await expect(
      root.parseAsync(["projects", "create", "--key", "dev", "--name", "Nope"], { from: "user" }),
    ).rejects.toThrow(/uppercase letters/);
    // And it names the flag the user typed, not the field the schema calls it.
    await expect(
      root.parseAsync(["projects", "create", "--key", "dev", "--name", "Nope"], { from: "user" }),
    ).rejects.toThrow(/--key/);
  });

  it("refuses what an Agent may not do, and says the key is why", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const said: string[] = [];
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      origin: baseURL,
      dir: "/nonexistent",
      // An Agent's key, which `agents.keys.issue` is a Sponsor's business.
      environment: { DEEVY_API_KEY: "deevy_sk_whatever" },
      fetchImpl: deevy.fetch,
      out: (line) => said.push(line),
    }));
    await expect(
      root.parseAsync(["agents", "keys", "issue", "mem_1", "--name", "k"], { from: "user" }),
    ).rejects.toThrow(/DEEVY_API_KEY/);
  });
});

describe("what a person sees by default", () => {
  it("is the shaped answer, and --json is the exact one", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await mkdtemp(join(tmpdir(), "deevy-cli-out-"));
    scratch.push(dir);
    await writeToken(baseURL, await apiToken(deevy, "u1"), dir);

    const said: string[] = [];
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      origin: baseURL,
      dir,
      environment: {},
      fetchImpl: deevy.fetch,
      out: (line) => said.push(line),
    }));

    await root.parseAsync(["projects", "create", "--key", "DEV", "--name", "Dev"], {
      from: "user",
    });
    // Fields a person reads, not a JSON document they have to.
    expect(said.at(-1)).toContain("DEV");
    expect(said.at(-1)).not.toContain('"key":');

    await root.parseAsync(["projects", "create", "--key", "OPS", "--name", "Ops", "--json"], {
      from: "user",
    });
    expect(JSON.parse(said.at(-1) ?? "{}") as { key: string }).toMatchObject({ key: "OPS" });
  });
});
