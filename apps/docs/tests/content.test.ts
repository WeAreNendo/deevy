import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

// The pages written for the site (docs/plans/docs.md, "Writing the pages"):
// what every one of them carries, and what a deevy Cloud reader never meets.
const content = fileURLToPath(new URL("../content", import.meta.url));
const pages = readdirSync(content, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
  .map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return { name: relative(content, path), text: readFileSync(path, "utf8") };
  });

function frontmatter(text: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
}

/** Prose, without its frontmatter, fenced code or inline code. */
function prose(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

describe("the site's pages", () => {
  test("there are some", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  test.each(pages)("$name has a title and a description", ({ text }) => {
    const front = frontmatter(text);
    expect(front).toMatch(/^title: .+/m);
    expect(front).toMatch(/^description: .+/m);
  });

  test.each(pages.filter(({ name }) => name !== "index.mdx"))(
    "$name says where it sits in its group",
    ({ text }) => {
      expect(frontmatter(text)).toMatch(/^sidebar:\n(?:\s+label: .+\n)?\s+order: \d+/m);
    },
  );

  const cloud = pages.filter(({ name }) => /^(get-started|cloud)\//.test(name));
  test.each(cloud)("$name speaks to a deevy Cloud team, who never sees a server", ({ text }) => {
    // An environment variable is how a self-hoster configures deevy; a team on
    // deevy Cloud has none to set.
    expect(prose(text)).not.toMatch(/\b(DEEVY|BETTER_AUTH)_[A-Z_]+/);
  });

  test.each(pages)("$name uses deevy's words, not the ones CONTEXT.md avoids", ({ text }) => {
    expect(prose(text)).not.toMatch(/\b(tenant|tenants|multi-tenant)\b/i);
  });
});

// The landing's sections are components (src/components/home), whose links the
// links validator in astro.config.ts cannot see and whose copy the tests above
// do not read; these hold them to the same rules.
const componentsDir = fileURLToPath(new URL("../src/components", import.meta.url));
const components = readdirSync(componentsDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(astro|ts)$/.test(entry.name))
  .map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return { name: relative(componentsDir, path), text: readFileSync(path, "utf8") };
  });

/** The page a site-relative link lands on, as a file in content/, or null. */
function pageFor(href: string): string | null {
  const path = href.replace(/#.*$/, "").replace(/^\/|\/$/g, "");
  const candidates = path
    ? [`${path}.md`, `${path}.mdx`, `${path}/index.md`, `${path}/index.mdx`]
    : ["index.mdx", "index.md"];
  return candidates.find((candidate) => pages.some(({ name }) => name === candidate)) ?? null;
}

describe("the landing's components", () => {
  test.each(components)("$name links only to pages that exist", ({ text }) => {
    const links = [...text.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]!);
    for (const href of links) expect(pageFor(href), href).not.toBeNull();
  });

  test.each(components)("$name uses deevy's words, not the ones CONTEXT.md avoids", ({ text }) => {
    expect(text).not.toMatch(/\b(tenant|tenants|multi-tenant)\b/i);
  });
});
