import { describe, expect, it } from "vite-plus/test";
import { coloured, inkFor, plain, render, width } from "../src/render.ts";

describe("a list", () => {
  it("is a table, with the columns a person recognises a row by first", () => {
    const said = render(
      {
        issues: [
          { id: "iss_1", key: "DEV-1", title: "Ship it", stateId: "st_1", createdAt: "x" },
          { id: "iss_2", key: "DEV-2", title: "Document it", stateId: "st_2", createdAt: "y" },
        ],
        nextCursor: 2,
      },
      plain,
    );
    const [header, first] = said.split("\n");
    // `key` and `title` lead; `id` and `createdAt` are in almost everything and
    // interesting in almost nothing, so they are not what a row is read by.
    expect(header?.startsWith("key")).toBe(true);
    expect(header).toContain("title");
    expect(header).not.toContain("description");
    expect(first).toContain("DEV-1");
    // Columns line up, which is the whole reason not to print JSON.
    expect(said.split("\n")[1]?.indexOf("Ship it")).toBe(header?.indexOf("title"));
  });

  it("puts what rides beside the list underneath it", () => {
    const said = render({ issues: [{ key: "DEV-1", title: "x" }], nextCursor: 7 }, plain);
    expect(said.split("\n").at(-1)).toContain("nextCursor: 7");
  });

  it("says None rather than printing an empty table", () => {
    expect(render({ issues: [], nextCursor: null }, plain)).toBe("None.");
    expect(render([], plain)).toBe("None.");
  });
});

describe("a single thing", () => {
  it("is its fields, aligned", () => {
    const said = render({ id: "mem_1", handle: "ada", role: "admin" }, plain);
    expect(said.split("\n")).toEqual(["id      mem_1", "handle  ada", "role    admin"]);
  });

  /**
   * The bug this test exists for: the list branch fired on any array key, so
   * one Issue carrying its Labels was rendered as a table of its Labels and the
   * Issue itself became a footnote.
   */
  it("is not read as a list just because it carries one", () => {
    const said = render(
      { id: "iss_1", key: "DEV-1", title: "Ship it", labels: [{ id: "l1" }, { id: "l2" }] },
      plain,
    );
    expect(said.split("\n")[0]).toContain("iss_1");
    expect(said).toContain("DEV-1");
    expect(said).toContain("Ship it");
  });
});

describe("an answer that is only that it happened", () => {
  it("says the word the operation used", () => {
    expect(render({ deleted: true }, plain)).toBe("deleted.");
    expect(render({ revoked: true }, plain)).toBe("revoked.");
    expect(render({ deleted: false }, plain)).toBe("not deleted.");
  });
});

describe("what it will not pretend to understand", () => {
  it("still prints a nested shape rather than dropping it", () => {
    const said = render({ member: { handle: "ada" }, principal: { kind: "oauth" } }, plain);
    expect(said).toContain("ada");
    expect(said).toContain("oauth");
  });

  it("prints nothing for nothing", () => {
    expect(render(null, plain)).toBe("");
    expect(render(undefined, plain)).toBe("");
  });
});

describe("colour", () => {
  it("is only for somebody looking at a terminal", () => {
    expect(inkFor({ isTTY: false })).toBe(plain);
    expect(inkFor({})).toBe(plain);
  });

  it("is off when NO_COLOR is set, which is what every other tool honours", () => {
    const before = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(inkFor({ isTTY: true })).toBe(plain);
    } finally {
      if (before === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = before;
    }
  });

  it("never changes what the text says, only how it looks", () => {
    const value = { issues: [{ key: "DEV-1", title: "Ship it" }], nextCursor: null };
    // eslint-disable-next-line no-control-regex
    const stripped = render(value, coloured).replace(/\[\d+m/g, "");
    expect(stripped).toBe(render(value, plain));
  });
});

describe("what a table must not lose", () => {
  /**
   * The highest-value test in this file, and the one whose absence cost a
   * review round. The RPC link deserialises deevy's `timestamp_ms` columns
   * back into real Dates, so every "when" in the API is an object — and a rule
   * that skipped objects dropped `readAt`, `suspendedAt`, `disabledAt` and
   * every other one. An inbox that cannot show what is unread is not an inbox.
   */
  it("shows a time, because a Date is a value and not a nested shape", () => {
    const said = render(
      {
        notifications: [
          { id: "n1", title: "Gate waiting", readAt: null },
          { id: "n2", title: "Run finished", readAt: new Date("2026-09-17T10:00:00Z") },
        ],
        nextCursor: null,
      },
      plain,
    );
    expect(said).toContain("readAt");
    expect(said).toContain("2026-09-17");
    // And the unread one is visibly not read.
    expect(said.split("\n")[1]?.trimEnd()).toBe("Gate waiting");
  });

  it("names a State rather than showing the id beside it", () => {
    // `state` is an object whose `name` is "Intent"; `stateId` is
    // `st_w861nwy0a5h5`, and showing that in its place was showing an opaque
    // id where the payload already had the answer.
    const said = render(
      {
        issues: [
          { id: "i1", key: "DEV-1", title: "Ship it", stateId: "st_x", state: { name: "Intent" } },
        ],
        nextCursor: null,
      },
      plain,
    );
    expect(said).toContain("Intent");
    expect(said).not.toContain("st_x");
  });

  it("keeps free prose out of the grid, and bounds what it does show", () => {
    const said = render(
      {
        issues: [
          { key: "DEV-1", title: "x".repeat(300), description: "y".repeat(3000), n: 1 },
          { key: "DEV-2", title: "short", description: null, n: 2 },
        ],
        nextCursor: null,
      },
      plain,
    );
    expect(said).not.toContain("description");
    // One 3 KB value used to make every row of the table that wide.
    for (const line of said.split("\n")) expect(line.length).toBeLessThan(120);
  });

  it("puts a multi-line value on one line, because a newline breaks a grid", () => {
    const said = render([{ key: "DEV-1", title: "first\nsecond" }], plain);
    expect(said.split("\n")).toHaveLength(2);
    expect(said).toContain("first second");
  });

  it("does not spend a column on something blank in every row", () => {
    const said = render(
      [
        { key: "DEV-1", teamId: null },
        { key: "DEV-2", teamId: null },
      ],
      plain,
    );
    expect(said).not.toContain("teamId");
  });
});

describe("how wide a thing looks", () => {
  it("is columns, not UTF-16 units", () => {
    expect(width("ascii")).toBe(5);
    // Two columns each, one unit each.
    expect(width("修复")).toBe(4);
    // Two columns, two units.
    expect(width("🚀")).toBe(2);
    // A combining accent is part of the character before it.
    expect(width("cafe\u0301")).toBe(4);
  });

  it("keeps a grid square when a title is not ascii", () => {
    const said = render(
      [
        { title: "修复登录流程 🚀", n: 1 },
        { title: "plain ascii", n: 2 },
      ],
      plain,
    );
    const columnOf = (line: string) => width(line.slice(0, line.lastIndexOf(" ") + 1));
    const [, first, second] = said.split("\n");
    expect(columnOf(first ?? "")).toBe(columnOf(second ?? ""));
  });
});

describe("a shape that is not a list", () => {
  /**
   * `health.ping` is five facts about an instance, one of which is a list of
   * sign-in providers. Reading it as a wrapper made a liveness check answer
   * with a table of providers — or, on an instance with none configured, with
   * the single word "None."
   */
  it("is not read as one just because a list is in it", () => {
    const said = render(
      {
        ok: true,
        time: "2026-09-18T09:47:31Z",
        devSignIn: false,
        providers: [{ id: "github", label: "GitHub" }],
        liveDocuments: false,
      },
      plain,
    );
    expect(said.split("\n")[0]).toContain("ok");
    expect(said).not.toBe("None.");
    // The providers are still shown, under their own name.
    expect(said).toContain("providers (1)");
    expect(said).toContain("GitHub");
  });

  it("indents a nested shape rather than putting it on one line", () => {
    // Eight of an Issue's twenty-four fields are objects or arrays; one line
    // each was strictly worse to read than the JSON this replaced.
    const said = render({ key: "DEV-1", gate: { required: 2, eligible: 3 } }, plain);
    expect(said).toContain("gate");
    expect(said).toMatch(/\n {2}required {2}2/);
    expect(said).not.toContain('{"required"');
  });
});

describe("an answer that is a count", () => {
  it("reads as a sentence rather than as a field", () => {
    // `inbox mark-all-read` answered "read  0".
    expect(render({ read: 3 }, plain)).toBe("3 read.");
    expect(render({ unread: 0 }, plain)).toBe("0 unread.");
  });
});
