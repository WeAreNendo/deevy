import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): Promise<string> => readFile(path.join(root, file), "utf8");

/**
 * The record of what deevy is — the glossary, the plan, CLAUDE.md, the
 * internal and public docs, and the code's own words — after
 * docs/plans/simplify.md made it simpler (slice 13). History says what was:
 * the plans, the ADRs, the changelog and the changesets that become it, the
 * tests, which name a removed thing to prove it is gone, and the UI kit's last
 * sync. Everything else says what is.
 */
const history = [
  /^docs\/plans\//,
  /^docs\/adr\//,
  /(^|\/)CHANGELOG\.md$/,
  /^\.changeset\//,
  /(^|\/)tests?\//,
  /\.test\.tsx?$/,
  /^pnpm-lock\.yaml$/,
  // The UI kit as it was last synced to Claude Design, a snapshot of the
  // components of its day that the next sync replaces whole.
  /^\.design-sync\//,
];

/** What simplify.md took out, by the names it went by. */
const gone: Array<[what: string, pattern: RegExp]> = [
  ["the reference runtime", /apps\/agent\b/],
  ["the checkout deevy issued", /runs[._]checkout/],
  ["the pull request deevy opened", /pulls[._]open/],
  ["the email senders", /email_sender/],
  // The retired Channel, a place a Workspace's Events went out to. A chat
  // tool's channel is still a word, and the field that picks one is labelled
  // "Channel", so the retired one is its plural, a Channel after a word that
  // picks one out, or the pair it went with.
  [
    "the Channels",
    /\bChannels\b|\b(?:[Aa]n?|[Tt]he|[Nn]o|[Ee]ach|[Ee]very|[Ii]ts|[Tt]his|[Tt]hat|Slack) Channel\b|\bChannel and Sender\b/,
  ],
];

function tracked(): string[] {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "");
  // Listed as well as asked of git: the task cache fingerprints what a suite
  // reads, and git's index is not read here, so without the listings a file
  // added below the root would replay the last pass instead of being read.
  const folders = new Set(files.map((file) => path.dirname(file)));
  for (const folder of folders) {
    for (let up = path.dirname(folder); up !== "." && !folders.has(up); up = path.dirname(up)) {
      folders.add(up);
    }
  }
  for (const folder of folders) {
    try {
      readdirSync(path.join(root, folder));
    } catch {
      // a folder deleted in the working tree, not yet in the index
    }
  }
  return files.filter((file) => !history.some((pattern) => pattern.test(file)));
}

/** CONTEXT.md lists the retired words on purpose, under its last heading. */
function said(file: string, text: string): string {
  return file === "CONTEXT.md" ? (text.split("\n### Retired")[0] ?? text) : text;
}

describe("the record", () => {
  it("names nothing simplify.md took out, outside the history", async () => {
    const found: string[] = [];
    for (const file of tracked()) {
      let text: string;
      try {
        text = said(file, await read(file));
      } catch {
        continue; // a file deleted in the working tree, not yet in the index
      }
      if (text.includes("\0")) continue; // binary
      const lines = text.split("\n");
      for (const [what, pattern] of gone) {
        lines.forEach((line, index) => {
          // With the last word of the line before, for a name wrapped onto two.
          const wrapped = `${lines[index - 1]?.trim().split(/\s+/).at(-1) ?? ""} ${line.trim()}`;
          if (pattern.test(line) || pattern.test(wrapped)) {
            found.push(`${file}:${index + 1} names ${what}`);
          }
        });
      }
    }
    expect(found).toEqual([]);
  });

  it("retires the words that went, and defines what stayed as it is now", async () => {
    const context = await read("CONTEXT.md");
    const [current = "", retired = ""] = context.split("\n### Retired");
    for (const word of ["Identity", "Channel", "Sender", "Usage"]) {
      expect(retired, word).toContain(`**${word}**`);
      expect(current, word).not.toMatch(new RegExp(`^\\*\\*${word}\\*\\*:`, "m"));
    }
    const socket = /\*\*Socket\*\*:\n([\s\S]*?)\n_Avoid_/.exec(current)?.[1] ?? "";
    expect(socket).toContain("tracker, chat");
    expect(socket).not.toMatch(/\bforge\b|\bdocs\b/);
  });

  it("lists the MCP tools deevy serves, as the tool snapshot has them", async () => {
    const snapshot = JSON.parse(await read("packages/core/mcp-tools.json")) as Array<{
      name: string;
    }>;
    const plan = await read("docs/PLAN.md");
    const surface = /- \*\*MCP server\*\*[\s\S]*?(?=\n- \*\*)/.exec(plan)?.[0] ?? "";
    const named = [...surface.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((match) => match[1]);
    expect(named.toSorted()).toEqual(snapshot.map((tool) => tool.name).toSorted());
    const words = ["twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
    expect(surface).toContain(`The set is ${words[snapshot.length - 12] ?? snapshot.length}`);
  });

  it("records the milestone that made deevy simpler", async () => {
    const plan = await read("docs/PLAN.md");
    expect(plan).toMatch(/^\*\*Simpler\.\*\*/m);
    const claude = await read("CLAUDE.md");
    expect(claude).not.toContain("Build from that plan's slices in order");
  });
});
