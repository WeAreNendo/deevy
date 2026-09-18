import { describe, expect, it } from "vite-plus/test";
import { coloured, inkFor, plain, render } from "../src/render.ts";

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
    expect(header).not.toContain("createdAt");
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
