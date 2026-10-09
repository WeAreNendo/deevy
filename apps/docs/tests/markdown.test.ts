import { describe, expect, test } from "vite-plus/test";

import {
  blocks,
  firstParagraph,
  headings,
  maskCode,
  rewrite,
  sections,
  slugs,
} from "../scripts/markdown.ts";

const doc = [
  "# Running deevy",
  "",
  "Intro, see [the image](#the-image).",
  "",
  "## The image",
  "",
  "```sh",
  "## not a heading",
  "echo '[x](./nope.md)' ADR-0003",
  "```",
  "",
  "### Signing in, and the origin `BETTER_AUTH_URL` names",
  "",
  "~~~",
  "## still code",
  "~~~",
  "",
  "## The Worker",
  "",
  "Last.",
].join("\n");

describe("blocks", () => {
  test("puts back exactly what it split, with fenced code apart from the rest", () => {
    const parts = blocks(doc);
    expect(parts.map((part) => part.text).join("")).toBe(doc);
    expect(
      parts.filter((part) => part.code).map((part) => part.text.trim().split("\n")[0]),
    ).toEqual(["```sh", "~~~"]);
  });

  test("an indented fence inside a list item is still a fence", () => {
    const parts = blocks("1. Run it:\n\n   ```bash\n   # comment\n   ```\n");
    expect(parts.find((part) => part.code)?.text).toContain("# comment");
  });
});

describe("headings", () => {
  test("finds the headings outside code, with their offsets", () => {
    const found = headings(doc);
    expect(found.map((heading) => [heading.depth, heading.text])).toEqual([
      [1, "Running deevy"],
      [2, "The image"],
      [3, "Signing in, and the origin `BETTER_AUTH_URL` names"],
      [2, "The Worker"],
    ]);
    for (const heading of found) expect(doc.slice(heading.offset)).toMatch(/^#+ /);
  });
});

describe("slugs", () => {
  test("slug the rendered text, numbering a repeat the way Astro does", () => {
    expect(slugs(["Signing in, and the origin `BETTER_AUTH_URL` names", "Notes", "Notes"])).toEqual(
      ["signing-in-and-the-origin-better_auth_url-names", "notes", "notes-1"],
    );
  });

  test("a link in a heading slugs as its text", () => {
    expect(slugs(["Working in [GitHub](https://github.com)"])).toEqual(["working-in-github"]);
  });
});

describe("sections", () => {
  test("cuts at `##` outside code, dropping each heading line", () => {
    const parts = sections(doc, 2);
    expect(parts.map((part) => part.title)).toEqual([null, "The image", "The Worker"]);
    expect(parts[1].body).toContain("## not a heading");
    expect(parts[1].body).not.toMatch(/^## The image/m);
    expect(parts[2].body.trim()).toBe("Last.");
  });
});

describe("maskCode", () => {
  test("masks a span that wraps onto the next line, at the same length", () => {
    const text = "run `cloudflared tunnel\nrun --url x` then [a](b.md)";
    const masked = maskCode(text);
    expect(masked).toHaveLength(text.length);
    expect(masked).not.toContain("cloudflared");
    expect(masked).toContain("[a](b.md)");
  });

  test("never across a blank line, and an unmatched backtick is just a backtick", () => {
    expect(maskCode("a `b\n\nc` d")).toBe("a `b\n\nc` d");
  });
});

describe("rewrite", () => {
  const seen: string[] = [];
  const rewriter = {
    link: (destination: string) => {
      seen.push(destination);
      return destination.replace(/\.md/, "/");
    },
    adr: (number: string) => (number === "9999" ? undefined : `/decisions/${number}/`),
  };

  test("rewrites link destinations in prose and never in code", () => {
    seen.length = 0;
    const out = rewrite(
      'See [a](./a.md#x "A"), `[b](./b.md)`, ![c](c.md) and\n\n[ref]: ./d.md\n\n```\n[e](./e.md)\n```\n',
      rewriter,
    );
    expect(seen).toEqual(["./a.md#x", "c.md", "./d.md"]);
    expect(out).toContain('[a](./a/#x "A")');
    expect(out).toContain("`[b](./b.md)`");
    expect(out).toContain("[ref]: ./d/");
    expect(out).toContain("[e](./e.md)");
  });

  test("a link whose text is code is still a link", () => {
    expect(rewrite("[`x.md`](./x.md)", rewriter)).toBe("[`x.md`](./x/)");
  });

  test("links ADR numbers in prose, but not in code, link text or headings", () => {
    const out = rewrite(
      "## Why ADR-0004\n\nAs ADR-0004 says, not `ADR-0005`, not [ADR-0006](./6.md), not ADR-9999.\n",
      rewriter,
    );
    expect(out).toBe(
      "## Why ADR-0004\n\nAs [ADR-0004](/decisions/0004/) says, not `ADR-0005`, not [ADR-0006](./6/), not ADR-9999.\n",
    );
  });

  test("raises headings outside code", () => {
    const out = rewrite("### Deep\n\n```\n### code\n```\n#### Deeper\n", {
      link: (d) => d,
      raise: 1,
    });
    expect(out).toBe("## Deep\n\n```\n### code\n```\n### Deeper\n");
  });
});

describe("firstParagraph", () => {
  test("is the opening prose as text", () => {
    expect(firstParagraph("\nThe `image` is [one](x) container.\nAnd a volume.\n\nMore.")).toBe(
      "The image is one container. And a volume.",
    );
  });

  test("is nothing when a page opens with a list, a table or code", () => {
    expect(firstParagraph("- a\n- b")).toBeUndefined();
    expect(firstParagraph("| a | b |")).toBeUndefined();
    expect(firstParagraph("```\ncode\n```\n\nText.")).toBeUndefined();
  });
});
