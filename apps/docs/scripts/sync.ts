/**
 * Fills Starlight's content directory before Astro starts (package.json), and
 * again by hand while `astro dev` runs: the pages written for the site in
 * apps/docs/content, copied as they are, and the API reference written from
 * packages/core/openapi.json. Nothing in docs/ is published: that is the
 * repository's own documentation, for the people building deevy
 * (docs/plans/docs.md). Everything this writes is gitignored, and a page whose
 * source went away goes too.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = join(app, "../..");
const out = {
  content: join(app, "src/content/docs"),
  generated: join(app, ".generated"),
};

function read(source: string): string {
  return readFileSync(join(root, source), "utf8");
}

/**
 * "Edit page" goes to the page's own file in content/, not the copy Astro reads,
 * unless the page says otherwise (the landing says `editUrl: false`).
 */
function withEditUrl(text: string, path: string): string {
  if (!text.startsWith("---\n") || /^editUrl:/m.test(text.split("\n---\n")[0])) return text;
  const url = `https://github.com/WeAreNendo/deevy/edit/main/apps/docs/content/${path}`;
  return text.replace("---\n", `---\neditUrl: ${url}\n`);
}

/** The pages written for the site, copied in with their own "Edit page" link. */
function pages(): number {
  const from = join(app, "content");
  let count = 0;
  for (const entry of readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const path = relative(from, source);
    write(join(out.content, path), withEditUrl(readFileSync(source, "utf8"), path));
    count++;
  }
  return count;
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
    "Every operation deevy has, over HTTP. The app, the CLI and the MCP tools are built on the same",
    "operations, so this is the whole surface rather than a public slice of it.",
    "",
    "Paths are under your Workspace's own `/api`. A request carries one of three credentials: the session",
    "of a Human signed in to the app; an Agent's API key, as `Authorization: Bearer <key>`; or an OAuth",
    "access token issued for the API, which is what the [CLI](/mcp-and-cli/cli/) holds. An Agent is",
    "refused every operation it has not been allowed ([what an Agent may do](/agents/permissions/)).",
    "",
    "This reference is built from the `main` branch. Your own deevy serves the document for the version it",
    "runs at `/api/spec.json`, with a reference to try requests in at `/api/docs`.",
  ].join("\n");
  document.servers = (document.servers ?? []).map((server) => ({
    ...server,
    description: server.description ?? "On your Workspace's own origin",
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
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !written.has(path)) rmSync(path);
  }
}

const count = pages();
apiReference();
prune(out.content);
prune(out.generated);
console.log(`docs: ${String(count)} pages from apps/docs/content, and the API reference`);
