/**
 * Taking a hosted Workspace home (docs/OPERATIONS.md, "Taking a hosted
 * Workspace home"): the dump the hosted console hands over, loaded into the
 * database this image starts on, or turned into SQL for a D1 database of the
 * team's own.
 *
 *   docker run --rm -i -v deevy-data:/data ghcr.io/wearenendo/deevy \
 *     dist/import.mjs - < workspace.sql
 *   docker run --rm -i ghcr.io/wearenendo/deevy dist/import.mjs --for-d1 - \
 *     < workspace.sql > workspace.d1.sql
 *
 * It reads the environment as the server does: `DEEVY_DATABASE_PATH` is where
 * the database goes, and `BETTER_AUTH_URL` and `DEEVY_SECRET`, when they are
 * set, are what it checks the dump against and names in what it prints. A
 * second entry beside `index.mjs` and `seed.mjs` rather than a flag on the
 * server, because the image's entrypoint is node and it has no shell to pick
 * one with.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readEnv } from "./env.ts";
import { dumpForD1, ImportRefused, importDump, type ImportReport } from "./import-dump.ts";

const USAGE = `Usage:
  node dist/import.mjs <dump.sql>            load a hosted Workspace's dump into DEEVY_DATABASE_PATH
  node dist/import.mjs --for-d1 <dump.sql>   write it as SQL for a new D1 database, to stdout

<dump.sql> is the file the hosted export handed over, or - to read it from stdin.`;

const args = process.argv.slice(2);
const forD1 = args.includes("--for-d1");
const files = args.filter((arg) => arg !== "--for-d1");
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (files.length !== 1 || files[0]!.startsWith("--")) {
  console.error(USAGE);
  process.exit(2);
}

const env = readEnv();
const dump = files[0] === "-" ? readFileSync(0, "utf8") : readFileSync(files[0]!, "utf8");
const common = {
  dump,
  migrationsFolder: env.migrationsFolder,
  ...(env.baseURL ? { baseURL: env.baseURL } : {}),
  ...(env.socketSecret ? { socketSecret: env.socketSecret } : {}),
};

try {
  if (forD1) {
    const { sql, report } = await dumpForD1(common);
    process.stdout.write(sql);
    // stdout is the SQL, so everything said to the person goes to stderr.
    console.error(summary(report, "d1"));
    console.error(nextSteps(report, env.baseURL, "d1"));
  } else {
    const path = resolve(env.databasePath);
    const report = await importDump({ ...common, path });
    console.log(`Imported the Workspace "${report.workspace.name}" into ${path}.\n`);
    console.log(summary(report, "image"));
    console.log(nextSteps(report, env.baseURL, "image"));
  }
} catch (error) {
  if (!(error instanceof ImportRefused)) throw error;
  console.error(`Nothing was imported. ${error.message}`);
  process.exit(1);
}

type Target = "image" | "d1";

function summary(report: ImportReport, target: Target): string {
  const rows: Array<[string, string]> = [
    ["Workspace", `${report.workspace.name} (${report.workspace.slug})`],
    [
      "Humans",
      `${String(report.humans)}${report.admins.length > 0 ? `; admins ${report.admins.join(", ")}` : ""}`,
    ],
    ["Agents", String(report.agents)],
    [
      "Sockets",
      report.sockets.length === 0
        ? "none"
        : report.sockets.map(({ name, provider }) => `${name} (${provider})`).join(", "),
    ],
    ["Projects", String(report.projects)],
    ["Events", `${String(report.events)}; the next is #${String(report.nextSeq)}`],
    ["Lived at", report.previousURL ?? "an address the dump does not say"],
    ["Schema", schemaLine(report, target)],
    [
      "OAuth",
      report.forgotten.resources + report.forgotten.tokens === 0
        ? "nothing bound to the old address"
        : `removed ${plural(report.forgotten.resources, "resource")} and ${plural(report.forgotten.tokens, "token")} bound to the old address`,
    ],
    ["DEEVY_SECRET", sealedLine(report)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
  for (const warning of report.warnings) lines.push(`  ! ${warning}`);
  return `${lines.join("\n")}\n`;
}

function schemaLine(report: ImportReport, target: Target): string {
  if (report.migrations.length === 0) return "this release's, nothing to apply";
  const names = report.migrations.join(", ");
  const count = plural(report.migrations.length, "migration");
  return target === "image"
    ? `brought forward by ${count} this release added: ${names}`
    : `${count} newer than the dump, for wrangler d1 migrations apply: ${names}`;
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function sealedLine(report: ImportReport): string {
  if (!report.sealed) return "not set, so not checked against what the dump sealed with it";
  if (report.sealed.checked === 0) return "nothing in the dump is sealed with it";
  if (report.sealed.failed.length === 0) {
    return `opens ${report.sealed.checked === 1 ? "the one value" : `all ${String(report.sealed.checked)} values`} sealed with it`;
  }
  return `DOES NOT OPEN ${report.sealed.failed.join(", ")}: it is not the value the export handed over`;
}

/** Where each tool delivers now, and what to change there (OPERATIONS.md, "Connecting your tools"). */
function socketStep(socket: ImportReport["sockets"][number], url: string): string {
  const hook = `${url}/hooks/${socket.id}`;
  switch (socket.provider) {
    case "github":
      return `${socket.name} (GitHub): Point GitHub at this address on the Socket's page; in the App's settings, Setup URL ${hook}/setup`;
    case "linear":
      return `${socket.name} (Linear): the application's webhook ${hook}; its callback URLs ${url}/api/identities/linear/callback and ${hook}/setup`;
    case "gitlab":
      return `${socket.name} (GitLab): every bound project's or group's webhook ${hook}, same secret token`;
    case "notion":
      return `${socket.name} (Notion): a new webhook subscription to ${hook}, verified with the token the Socket's page shows; then delete the old one`;
    case "slack":
      return `${socket.name} (Slack): the app's Interactivity request URL and its /deevy command's URL ${hook}`;
    default:
      return `${socket.name} (${socket.provider}): ${hook}`;
  }
}

function nextSteps(report: ImportReport, baseURL: string | undefined, target: Target): string {
  const url = baseURL?.replace(/\/+$/, "") ?? "<BETTER_AUTH_URL>";
  const old = report.previousURL ?? "the hosted address";
  const sockets = report.sockets.filter(
    ({ status }) => status !== "removed" && status !== "pending",
  );
  const steps = [
    target === "d1"
      ? `Apply it to a new, empty D1 database, in place of the first \`wrangler d1 migrations apply\`: wrangler d1 execute deevy --remote --file workspace.d1.sql${report.migrations.length > 0 ? ", then wrangler d1 migrations apply deevy --remote for what is newer than the dump" : ""}.`
      : null,
    `Set BETTER_AUTH_SECRET and DEEVY_SECRET to the two values the export handed over${target === "d1" ? ", with wrangler secret put" : ""}. The Sockets' credentials, invitation links and the OAuth signing keys open only under them.`,
    `Set BETTER_AUTH_URL to this deevy's own URL${baseURL ? ` (${url})` : ""}, and register an OAuth App for each sign-in provider with ${url}/api/auth/callback/<provider>: the hosted ones were the platform's. Everybody signs in again and lands on their own account. DEEVY_ADMIN_EMAIL can stay unset: the Workspace's admins came with it.`,
    `Point every Agent's DEEVY_URL at ${url} instead of ${old}. Their API keys still work.`,
    sockets.length > 0
      ? `Point each Socket's tool at its new address:\n${sockets.map((socket) => `       - ${socketStep(socket, url)}`).join("\n")}`
      : null,
    `Sign the CLI and every MCP client in again: deevy login ${url}. What they held was issued by ${old}.`,
    "Once this deevy is up, delete the hosted Workspace, so nothing is written to the copy you left.",
  ].filter((step): step is string => step !== null);
  return `\nNext:\n${steps.map((step, index) => `  ${String(index + 1)}. ${step}`).join("\n")}\n`;
}
