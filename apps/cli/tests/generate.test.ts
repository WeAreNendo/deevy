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
    // `help` is commander's own, on every group it makes.
    expect(expected.filter((one) => !found.includes(one))).toEqual([]);
  });

  it("reads every input schema in the router, leaving nothing unexplained", () => {
    // A field the flag generator cannot name is a command somebody cannot use,
    // and the only one it may legitimately give up on is a free-form payload.
    const opaque = commands
      .filter((command) => !command.streaming)
      .flatMap((command) =>
        fieldsOf(command.inputSchema)
          .filter((field) => field.kind === "json")
          .map((field) => `${command.operation}.${field.name}`),
      );
    expect(opaque).toEqual(["runs.postActivity.payload"]);
  });

  it("makes a flag out of every field that is not a positional", () => {
    const create = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "create");
    const flags = (create?.options ?? []).map((option) => option.long);
    expect(flags).toContain("--project-key");
    expect(flags).toContain("--assignee-member-id");
    expect(flags).toContain("--json");
  });

  it("takes the path parameters as positionals, not as flags", () => {
    const move = built()
      .commands.find((c) => c.name() === "issues")
      ?.commands.find((c) => c.name() === "move");
    expect(move?.usage()).toContain("<key>");
    expect((move?.options ?? []).map((o) => o.long)).not.toContain("--key");
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
    const move = byOperation.get("issues.move");
    expect(move).toBeDefined();
    expect(inputFor(move!, ["DEV-42"], { stateId: "st_1" })).toEqual({
      key: "DEV-42",
      stateId: "st_1",
    });
  });

  it("leaves out what was not given, so a default in the schema still applies", () => {
    const list = byOperation.get("issues.list");
    expect(inputFor(list!, [], {})).toEqual({});
  });
});

describe("the four the CLI cannot do", () => {
  it("says a Gate is a Human's, and which ADRs say so", () => {
    const approve = byOperation.get("gates.approve");
    const said = sessionOnlyRefusal(approve!);
    expect(said).toContain("ruled by a Human in a browser");
    expect(said).toContain("ADR-0010");
  });

  it("gives the other pair their own reason, which is not the Gate one", () => {
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
    await root.parseAsync(["projects", "create", "--key", "DEV", "--name", "Dev"], {
      from: "user",
    });

    await root.parseAsync(
      ["issues", "create", "--project-key", "DEV", "--title", "Something to do"],
      { from: "user" },
    );
    const created = JSON.parse(said.at(-1) ?? "{}") as { key: string; title: string };
    expect(created.title).toBe("Something to do");
    expect(created.key).toMatch(/^DEV-\d+$/);

    await root.parseAsync(["issues", "list", "--project-key", "DEV"], { from: "user" });
    const listed = JSON.parse(said.at(-1) ?? "{}") as { issues: { key: string }[] };
    expect(listed.issues.map((issue) => issue.key)).toContain(created.key);
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
