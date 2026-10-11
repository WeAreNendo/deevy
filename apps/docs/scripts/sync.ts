/**
 * Writes the docs site's content from the repository's own Markdown, so there is
 * one copy of every page and it is the one in `docs/`. Run before `astro build`
 * and `astro dev` (package.json), and again by hand while `astro dev` runs;
 * everything it writes is gitignored, and a page whose source went away goes too.
 *
 * - docs/OPERATIONS.md is cut into a page per `##` section, its `###` raised to `##`.
 * - DEVELOPMENT.md, harnesses.md, the two worked examples and CONTEXT.md (as the
 *   Glossary) are a page each, and every ADR is a page under Design decisions.
 * - A link between published files becomes a link between their pages, landing
 *   on the same heading even when that heading moved to another page in the cut;
 *   a link to any other file in the repository goes to it on GitHub; a link to a
 *   file that does not exist, or to a heading that does not, stops the sync.
 *   The link validator then checks every page Astro built, hashes included.
 * - `ADR-nnnn` in prose links to that decision.
 * - packages/core/openapi.json becomes the API reference, grouped by the area of
 *   the registry each operation belongs to (`runs.start` is under Runs).
 *
 * docs/plans stays in the repository: a plan is how a slice was argued, not how
 * deevy works, and a link to one goes to GitHub.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  blocks,
  firstParagraph,
  type Heading,
  headings,
  maskCode,
  plainText,
  rewrite,
  sections,
  slugs,
} from "./markdown.ts";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = join(app, "../..");
const out = {
  content: join(app, "src/content/docs"),
  assets: join(app, "public/repo"),
  generated: join(app, ".generated"),
};

const repository = "https://github.com/WeAreNendo/deevy";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif"]);

interface Page {
  /** The file it comes from, relative to the repository root. */
  source: string;
  /** Where it is written under src/content/docs, without the extension. */
  path: string;
  title: string;
  label?: string;
  order: number;
  /** Markdown as the repository has it, its links still relative to `source`. */
  body: string;
  /** Markdown the sync wrote, with the site's own links, appended after the body is rewritten. */
  appendix?: string;
  /** Levels each heading in the body is raised by. */
  raise: number;
  /** False for a page the sync composed, which has no file of its own to edit. */
  editable?: false;
}

/** A published file: its pages, and which page and heading each of its headings' anchors now lands on. */
interface Published {
  pages: Page[];
  anchors: Map<string, { page: Page; slug: string }>;
}

const published = new Map<string, Published>();
const adrs = new Map<string, Page>();

function read(source: string): string {
  return readFileSync(join(root, source), "utf8");
}

function url(page: Page): string {
  return `/${page.path.replace(/(^|\/)index$/, "")}/`.replace(/\/+/g, "/");
}

/** The body without its first line, when that line is the document's `#` title. */
function withoutTitle(markdown: string): string {
  const first = headings(markdown)[0];
  if (first?.depth !== 1) return markdown;
  const end = markdown.indexOf("\n", first.offset);
  return (markdown.slice(0, first.offset) + (end < 0 ? "" : markdown.slice(end + 1))).replace(
    /^\s*\n/,
    "",
  );
}

/**
 * Registers a file's pages, each with the span of the file it holds and the
 * heading that is its title — the top of the page rather than a heading in it,
 * so a link to that heading lands on the page itself. GitHub numbers a repeated
 * heading across the whole file and Astro across one page, so the two are
 * worked out separately and paired up.
 */
function publish(
  source: string,
  markdown: string,
  spans: { page: Page; start: number; end: number; top?: Heading }[],
) {
  const all = headings(markdown);
  const sourceSlugs = slugs(all.map((heading) => heading.text));
  const anchors = new Map<string, { page: Page; slug: string }>();
  for (const { page, start, end, top } of spans) {
    const inside = all
      .map((heading, i) => ({ heading, slug: sourceSlugs[i] }))
      .filter(({ heading }) => heading.offset >= start && heading.offset < end);
    const isTop = (heading: Heading) => heading.offset === top?.offset;
    const onPage = inside.filter(({ heading }) => !isTop(heading));
    const pageSlugs = slugs(onPage.map(({ heading }) => heading.text));
    for (const { heading, slug } of inside) {
      if (isTop(heading)) anchors.set(slug, { page, slug: "" });
    }
    onPage.forEach(({ slug }, n) => anchors.set(slug, { page, slug: pageSlugs[n] }));
  }
  published.set(source, { pages: spans.map(({ page }) => page), anchors });
}

/** A whole file as one page. */
function whole(
  source: string,
  path: string,
  options: { title?: string; label?: string; order: number },
): Page {
  const markdown = read(source);
  const h1 = headings(markdown).find((heading) => heading.depth === 1);
  const page: Page = {
    source,
    path,
    title: options.title ?? plainText(h1?.text ?? path),
    label: options.label,
    order: options.order,
    body: withoutTitle(markdown),
    raise: 0,
  };
  publish(source, markdown, [{ page, start: 0, end: markdown.length, top: h1 }]);
  return page;
}

/** A file cut into a page per `##` section, under `directory`, with what comes before the first as its index. */
function split(source: string, directory: string, indexLabel: string): Page[] {
  const markdown = read(source);
  const h1 = headings(markdown).find((heading) => heading.depth === 1);
  const cuts = headings(markdown).filter((heading) => heading.depth === 2);
  const parts = sections(markdown, 2);
  const pages: { page: Page; start: number; end: number; top?: Heading }[] = [];
  const titles = slugs(parts.slice(1).map((part) => part.title ?? ""));
  parts.forEach((part, i) => {
    const start = i === 0 ? 0 : cuts[i - 1].offset;
    const end = cuts[i]?.offset ?? markdown.length;
    const page: Page =
      i === 0
        ? {
            source,
            path: `${directory}/index`,
            title: plainText(h1?.text ?? directory),
            label: indexLabel,
            order: 0,
            body: withoutTitle(part.body),
            raise: 0,
          }
        : {
            source,
            path: `${directory}/${titles[i - 1]}`,
            title: plainText(part.title ?? ""),
            order: i,
            body: part.body.replace(/^\s*\n/, ""),
            raise: 1,
          };
    pages.push({ page, start, end, top: i === 0 ? h1 : cuts[i - 1] });
  });
  publish(source, markdown, pages);
  const [index, ...rest] = pages.map(({ page }) => page);
  index.appendix = rest.map((page) => `- [${page.title}](${url(page)})`).join("\n");
  return pages.map(({ page }) => page);
}

function decisions(): Page[] {
  const directory = "docs/adr";
  const files = readdirSync(join(root, directory))
    .filter((file) => /^\d{4}-.*\.md$/.test(file))
    .toSorted();
  const pages = files.map((file) => {
    const number = file.slice(0, 4);
    const page = whole(`${directory}/${file}`, `decisions/${file.replace(/\.md$/, "")}`, {
      order: Number(number),
    });
    page.label = `${number} · ${page.title}`;
    page.title = `ADR-${number}: ${page.title}`;
    adrs.set(number, page);
    return page;
  });
  const index: Page = {
    source: directory,
    path: "decisions/index",
    title: "Design decisions",
    label: "All decisions",
    order: 0,
    body: "",
    appendix: [
      "The choices that would be expensive to reverse, one page each and numbered in the order they were made.",
      "Each says what was decided, what else was considered, and why it lost. A later decision that changes an",
      "earlier one says so, and the earlier one stays as it was written.",
      "",
      ...pages.map((page) => `- [${page.title}](${url(page)})`),
    ].join("\n"),
    raise: 0,
    editable: false,
  };
  return [index, ...pages];
}

/** Where a link written in `from` should go on the site. */
function resolveLink(destination: string, from: Page): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith("//")) return destination;
  const hashAt = destination.indexOf("#");
  const path = decodeURI(hashAt < 0 ? destination : destination.slice(0, hashAt));
  const hash = hashAt < 0 ? "" : destination.slice(hashAt + 1);
  const target =
    path === ""
      ? from.source
      : posix
          .normalize(
            path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(from.source), path),
          )
          .replace(/\/$/, "");

  const file = published.get(target);
  if (file) {
    const landing = hash === "" ? { page: file.pages[0], slug: "" } : file.anchors.get(hash);
    if (!landing)
      throw new Error(`${from.source}: "${destination}" names a heading ${target} does not have`);
    if (landing.page === from && landing.slug !== "") return `#${landing.slug}`;
    return url(landing.page) + (landing.slug ? `#${landing.slug}` : "");
  }

  const onDisk = join(root, target);
  if (target.startsWith("..") || !existsSync(onDisk)) {
    throw new Error(`${from.source}: "${destination}" is not a file in the repository`);
  }
  if (imageExtensions.has(posix.extname(target).toLowerCase())) {
    mkdirSync(dirname(join(out.assets, target)), { recursive: true });
    cpSync(onDisk, join(out.assets, target));
    return `/repo/${target}`;
  }
  const kind = statSync(onDisk).isDirectory() ? "tree" : "blob";
  return `${repository}/${kind}/main/${target}${hash ? `#${hash}` : ""}`;
}

function render(page: Page): string {
  const body = rewrite(page.body, {
    link: (destination) => resolveLink(destination, page),
    adr: (number) => {
      const adr = adrs.get(number);
      return adr && adr !== page ? url(adr) : undefined;
    },
    raise: page.raise,
  });
  return page.appendix ? `${body.trimEnd()}\n\n${page.appendix}\n`.trimStart() : body;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** The opening sentences of a paragraph, enough for a search result's snippet and not much more. */
function summary(paragraph: string | undefined): string | undefined {
  if (!paragraph) return undefined;
  let out = "";
  for (const sentence of paragraph.split(/(?<=[.!?])\s+(?=[A-Z`*[(])/)) {
    out = out ? `${out} ${sentence}` : sentence;
    if (out.length >= 120) break;
  }
  return out.length > 300 ? `${out.slice(0, 297).trimEnd()}…` : out;
}

function frontmatter(page: Page, body: string): string {
  const description = summary(firstParagraph(body));
  const lines = [
    "---",
    `title: ${yamlString(page.title)}`,
    ...(description ? [`description: ${yamlString(description)}`] : []),
    `editUrl: ${page.editable === false ? "false" : yamlString(`${repository}/edit/main/${page.source}`)}`,
    "sidebar:",
    ...(page.label ? [`  label: ${yamlString(page.label)}`] : []),
    `  order: ${page.order}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

/**
 * MDX reads `{` as an expression and `<` as a tag, so prose copied into an
 * `.mdx` page has them escaped outside code.
 */
function mdxSafe(markdown: string): string {
  return blocks(markdown)
    .map((block) => {
      if (block.code) return block.text;
      const masked = maskCode(block.text);
      return block.text
        .split("")
        .map((char, i) =>
          masked[i] === "\u0000"
            ? char
            : char === "{"
              ? "\\{"
              : char === "}"
                ? "\\}"
                : char === "<"
                  ? "&lt;"
                  : char,
        )
        .join("");
    })
    .join("");
}

/** README.md's first paragraph under "Status": what deevy is, in the words the repository uses. */
function whatDeevyIs(): string {
  const readme = read("README.md");
  const status = sections(readme, 2).find((section) => section.title === "Status");
  const paragraph = status?.body.split(/\n[ \t]*\n/).find((part) => part.trim().length > 0);
  if (!paragraph)
    throw new Error('README.md: no paragraph under "## Status" to open the docs with');
  const pseudo: Page = {
    source: "README.md",
    path: "",
    title: "",
    order: 0,
    body: paragraph.trim(),
    raise: 0,
  };
  return mdxSafe(render(pseudo));
}

/** Pages written for the site alone (apps/docs/content), copied in with their one placeholder filled. */
function handWritten() {
  const from = join(app, "content");
  for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const text = readFileSync(source, "utf8").replace("{/* README.md: Status */}", () =>
      whatDeevyIs(),
    );
    write(join(out.content, relative(from, source)), text);
  }
}

/** Labels for the registry's areas where capitalising the operation id's first segment reads wrong. */
const areaLabels: Record<string, string> = {
  me: "You",
  oauthClients: "OAuth clients",
  pulls: "Pull requests",
  docs: "Project docs",
};

interface OpenAPIDocument {
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, { operationId?: string; tags?: string[] }>>;
}

function apiReference() {
  const document = JSON.parse(read("packages/core/openapi.json")) as OpenAPIDocument;
  const { version } = JSON.parse(read("package.json")) as { version: string };
  const tags: string[] = [];
  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations)) {
      if (!operation.operationId || operation.tags?.length) continue;
      const area = operation.operationId.split(".")[0];
      const tag = areaLabels[area] ?? area.charAt(0).toUpperCase() + area.slice(1);
      operation.tags = [tag];
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  document.tags = [...(document.tags ?? []), ...tags.map((name) => ({ name }))];
  document.info.version = version;
  document.info.description = [
    "Every operation deevy has, over HTTP. One registry defines them all and is also behind the MCP tools,",
    "the CLI and the app ([ADR-0005](/decisions/0005-one-core-three-surfaces/)), so this is the whole",
    "surface rather than a public slice of it.",
    "",
    "Paths are under your deevy's own `/api`. A request carries one of three credentials: the session of a",
    "Human signed in to the app; an Agent's API key, as `Authorization: Bearer <key>`; or an OAuth access",
    "token issued for the API, which is what the CLI holds",
    "([ADR-0023](/decisions/0023-the-api-is-its-own-protected-resource/)). An Agent is refused any",
    "operation it has not been allowed ([ADR-0011](/decisions/0011-agents-are-default-denied-per-operation/)).",
    "",
    "This reference is built from the `main` branch. Your own deevy serves the document for the version it",
    "runs at `/api/spec.json`, with a reference to try requests in at `/api/docs`.",
  ].join("\n");
  document.servers = (document.servers ?? []).map((server) => ({
    ...server,
    description: server.description ?? "On your deevy's own origin",
  }));
  write(join(out.generated, "openapi.json"), `${JSON.stringify(document, null, 2)}\n`);
}

const written = new Set<string>();

/**
 * Writes a file only when its text changed, so a running `astro dev` reloads the
 * pages that moved and not all of them, and remembers it was meant to be there.
 */
function write(target: string, text: string) {
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target) || readFileSync(target, "utf8") !== text) writeFileSync(target, text);
  written.add(target);
}

/** Removes what an earlier run wrote and this one did not: a page whose source went away. */
function prune(dir: string) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !written.has(path)) rmSync(path);
  }
}

function main() {
  // Made again by the first image a page links to, if any does.
  rmSync(out.assets, { recursive: true, force: true });

  const pages: Page[] = [
    ...split("docs/OPERATIONS.md", "running", "Overview"),
    whole("docs/agent-loop.md", "guides/agent-loop", { order: 1 }),
    whole("docs/as-yourself.md", "guides/as-yourself", { order: 2 }),
    whole("CONTEXT.md", "glossary", { title: "Glossary", order: 0 }),
    whole("docs/DEVELOPMENT.md", "developing/index", { label: "Overview", order: 0 }),
    whole("docs/harnesses.md", "developing/harnesses", { label: "Harnesses", order: 1 }),
    ...decisions(),
  ];

  for (const page of pages) {
    const body = render(page);
    write(join(out.content, `${page.path}.md`), frontmatter(page, body) + body);
  }
  handWritten();
  apiReference();
  prune(out.content);
  prune(out.generated);

  console.log(`docs: ${pages.length} pages from the repository's Markdown, and the API reference`);
}

main();
