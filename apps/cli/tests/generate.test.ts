import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { router } from "@deevy/core/router";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { commandsFor } from "../src/commands.ts";
import { coerce, fieldsOf, flagNameFor } from "../src/flags.ts";
import { addGeneratedCommands, inputFor } from "../src/generate.ts";
import { agentKey, asAdmin, baseURL, testDeevy, type TestDeevy } from "./helpers.ts";

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
  return addGeneratedCommands(root, () => ({ baseURL: "http://localhost:3000" }));
}

/**
 * What a Human sets up in deevy's own pages before an Agent has anything to
 * read: a Socket, a Project bound to a container in it, and the Agent granted
 * that Project. None of it is the CLI's to do (ADR-0035).
 */
async function boundProjects(deevy: TestDeevy, scopes: Record<string, string>) {
  const admin = await asAdmin(deevy);
  const socket = await admin.sockets.connect({
    provider: "stub",
    name: "Example tracker",
    webhookSecret: "a-secret-the-tracker-signs-with",
  });
  for (const [slug, scopeKey] of Object.entries(scopes)) {
    const project = await admin.projects.create({
      slug,
      name: slug,
      tracker: { socketId: socket.id, scope: { scopeKey } },
    });
    await admin.agents.grants.add({ memberId: "m2", projectId: project.id });
  }
  return socket;
}

/** The generated commands as the Agent whose key is given, at the test's deevy. */
async function asAgent(deevy: TestDeevy, key: string) {
  const dir = await mkdtemp(join(tmpdir(), "deevy-cli-gen-"));
  scratch.push(dir);
  const said: string[] = [];
  const root = new Command().name("deevy").exitOverride();
  addGeneratedCommands(root, () => ({
    baseURL,
    // Where the capabilities cache goes, so a test never writes to ~/.config.
    dir,
    environment: { DEEVY_API_KEY: key },
    fetchImpl: deevy.fetch,
    out: (line) => said.push(line),
  }));
  return { root, said };
}

describe("what the registry turns into", () => {
  it("gives every operation an Agent may call a command, and nothing else", () => {
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
    const expected = commands.map((command) => command.words.join(" "));
    // Equality both ways: a subset check would pass an extra command nobody
    // meant to generate as happily as the right set.
    expect(found.filter((one) => one !== "help").sort()).toEqual([...expected].sort());
    // And a Human's operation is genuinely absent rather than merely
    // unasserted: the Event stream, a Gate's ruling, a Sponsor's key.
    for (const human of ["events subscribe", "gates approve", "agents keys issue"]) {
      expect(found).not.toContain(human);
    }
  });

  it("reads every input schema in the router, and names what it cannot explain", () => {
    // A field the generator cannot name is one a user has to hand-write JSON
    // for, and an array *of* json counts — the first version of this test
    // looked only at the field's own kind and reported one.
    const opaque = commands.flatMap((command) =>
      fieldsOf(command.inputSchema)
        .filter((field) => field.kind === "json" || field.element === "json")
        .map((field) => `${command.operation}.${field.name}`),
    );
    expect(opaque.sort()).toEqual([
      // The evidence a Proposal points at: a list of objects, and flattening it
      // into flags would be guessing at a shape a team decides (ADR-0020).
      "gates.request.links",
      "runs.postActivity.payload",
    ]);
  });

  it("gives every flag a name that carries its value back", () => {
    // The guard in optionFor, exercised over the whole router: commander
    // camelCases a flag into a property name and inputFor reads the field name,
    // so a disagreement is a value collected and then dropped.
    expect(() => built()).not.toThrow();
  });

  it("lets a boolean be said either way", () => {
    // `issues list --open false` is how closed records are asked for, and a
    // bare switch could only ever have said true.
    const list = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "list");
    const open = (list?.options ?? []).find((option) => option.long === "--open");
    expect(open?.argChoices).toEqual(["true", "false"]);
    expect(open?.required).toBe(false);
  });

  it("makes a flag out of every field that is not a positional", () => {
    const list = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "list");
    const flags = (list?.options ?? []).map((option) => option.long);
    expect(flags).toContain("--project-slug");
    expect(flags).toContain("--assignee-member-id");
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
    const link = byOperation.get("links.add");
    expect(link).toBeDefined();
    // The record is named by one string, which is an id, a URL or the key the
    // tracker wrote (ADR-0024).
    expect(
      inputFor(link!, ["acme/deevy#42"], { url: "https://example.com/pull/1", title: "PR" }),
    ).toEqual({ issue: "acme/deevy#42", url: "https://example.com/pull/1", title: "PR" });
  });

  it("leaves out what was not given, so a default in the schema still applies", () => {
    const list = byOperation.get("issues.list");
    expect(inputFor(list!, [], {})).toEqual({});
  });
});

describe("a generated command against a real deevy", () => {
  /**
   * The claim the whole CLI rests on: a command nobody wrote, built from the
   * registry, reaching a real instance over the real transport with a real
   * Agent's key, and coming back with the thing it asked for.
   */
  it("reads back a record the tracker delivered, by list and by its key", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    const socket = await boundProjects(deevy, { "acme-deevy": "acme/deevy" });

    // The record is opened in the tracker, by whoever opens records there, and
    // deevy hears of it in a delivery (docs/plans/simplify.md, slice 4).
    const delivered = await deevy.fetch(`${baseURL}/hooks/${socket.id}`, {
      method: "POST",
      body: JSON.stringify({
        events: [
          {
            kind: "issue",
            scopeKey: "acme/deevy",
            actor: { login: "ada", id: "u-ada", isBot: false },
            issue: {
              externalId: "1",
              key: "acme/deevy#1",
              url: "https://tracker.test/acme/deevy/issues/1",
              title: "Something to do",
              body: "",
              state: "open",
              stateName: "open",
              assignees: [],
              labels: [],
              parentExternalId: null,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    });
    expect(delivered.status).toBe(200);

    // `--json` because this asserts on the exact answer, which is what the
    // flag is for; the shaped output is the default and is tested in render.
    const { root, said } = await asAgent(deevy, key);
    await root.parseAsync(["issues", "list", "--project-slug", "acme-deevy", "--json"], {
      from: "user",
    });
    const listed = JSON.parse(said.at(-1) ?? "{}") as { issues: { externalKey: string }[] };
    // The key is the tracker's, and it is the only one there is (ADR-0024).
    expect(listed.issues.map((issue) => issue.externalKey)).toEqual(["acme/deevy#1"]);

    await root.parseAsync(["issues", "get", "acme/deevy#1", "--json"], { from: "user" });
    const read = JSON.parse(said.at(-1) ?? "{}") as { title: string };
    expect(read.title).toBe("Something to do");
  });

  it("hands back what zod actually said, not 'Input validation failed'", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const { root } = await asAgent(deevy, await agentKey(deevy));

    // oRPC's own message is "Input validation failed"; the sentence worth
    // reading is the one the schema wrote, and it only arrives if `explain`
    // digs it out of data.issues.
    const notANumber = ["runs", "list", "--limit", "many"];
    await expect(root.parseAsync(notANumber, { from: "user" })).rejects.toThrow(/number/);
    // And it names the flag the user typed, not the field the schema calls it.
    await expect(root.parseAsync(notANumber, { from: "user" })).rejects.toThrow(/--limit/);
  });

  it("refuses a key that is not an Agent's, and says what DEEVY_API_KEY wants", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await agentKey(deevy);
    // Better Auth mints a key for anybody it is asked to; deevy takes one only
    // as an Agent's (ADR-0035).
    const humans = await deevy.auth.api.createApiKey({ body: { userId: "u1", name: "mine" } });
    const { root } = await asAgent(deevy, humans.key);

    await expect(root.parseAsync(["runs", "list"], { from: "user" })).rejects.toThrow(
      /DEEVY_API_KEY has to hold an Agent's key/,
    );
  });

  it("asks for a key before it asks deevy anything", async () => {
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({ baseURL, environment: {}, out: () => {} }));
    await expect(root.parseAsync(["runs", "list"], { from: "user" })).rejects.toThrow(
      /Set DEEVY_API_KEY/,
    );
  });
});

describe("what a person sees by default", () => {
  it("is the shaped answer, and --json is the exact one", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    await boundProjects(deevy, { "acme-deevy": "acme/deevy", "acme-ops": "acme/ops" });
    const { root, said } = await asAgent(deevy, key);

    await root.parseAsync(["projects", "get", "acme-deevy"], { from: "user" });
    // Fields a person reads, not a JSON document they have to.
    expect(said.at(-1)).toContain("acme-deevy");
    expect(said.at(-1)).not.toContain('"slug":');

    await root.parseAsync(["projects", "get", "acme-ops", "--json"], { from: "user" });
    expect(JSON.parse(said.at(-1) ?? "{}") as { slug: string }).toMatchObject({
      slug: "acme-ops",
    });
  });
});
