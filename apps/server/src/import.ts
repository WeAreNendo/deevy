/**
 * Taking a hosted Workspace home (docs/OPERATIONS.md, "Taking a hosted
 * Workspace home"): the dump the hosted console hands over, loaded into the
 * database this image starts on.
 *
 *   docker run --rm -i -v deevy-data:/data ghcr.io/wearenendo/deevy \
 *     dist/import.mjs - < workspace.sql
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
import { ImportRefused, importDump, type ImportReport } from "./import-dump.ts";

const USAGE = `Usage:
  node dist/import.mjs <dump.sql>   load a hosted Workspace's dump into DEEVY_DATABASE_PATH

<dump.sql> is the file the hosted export handed over, or - to read it from stdin.`;

const files = process.argv.slice(2);
if (files.includes("--help") || files.includes("-h")) {
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
  const path = resolve(env.databasePath);
  const report = await importDump({ ...common, path });
  console.log(`Imported the Workspace "${report.workspace.name}" into ${path}.\n`);
  console.log(summary(report));
  console.log(nextSteps(report, env.baseURL));
} catch (error) {
  if (!(error instanceof ImportRefused)) throw error;
  console.error(`Nothing was imported. ${error.message}`);
  process.exit(1);
}

function summary(report: ImportReport): string {
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
    ["Schema", schemaLine(report)],
    ["DEEVY_SECRET", sealedLine(report)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
  for (const warning of report.warnings) lines.push(`  ! ${warning}`);
  return `${lines.join("\n")}\n`;
}

function schemaLine(report: ImportReport): string {
  if (report.migrations.length === 0) return "this release's, nothing to apply";
  const names = report.migrations.join(", ");
  return `brought forward by ${plural(report.migrations.length, "migration")} this release added: ${names}`;
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
      return `${socket.name} (Linear): the application's webhook ${hook}; its callback URL ${hook}/setup`;
    case "gitlab":
      return `${socket.name} (GitLab): every bound project's or group's webhook ${hook}, same secret token`;
    case "notion":
      return `${socket.name} (Notion): a new webhook subscription to ${hook}, verified with the token the Socket's page shows; then delete the old one`;
    case "slack":
      return `${socket.name} (Slack): Slack sends deevy nothing now, so the app's Interactivity and its /deevy command can be turned off`;
    case "generic":
      return `${socket.name} (another tool): the address your adapter posts to, ${hook}, same secret`;
    default:
      return `${socket.name} (${socket.provider}): ${hook}`;
  }
}

function nextSteps(report: ImportReport, baseURL: string | undefined): string {
  const url = baseURL?.replace(/\/+$/, "") ?? "<BETTER_AUTH_URL>";
  const sockets = report.sockets.filter(
    ({ status }) => status !== "removed" && status !== "pending",
  );
  const steps = [
    `Set BETTER_AUTH_SECRET and DEEVY_SECRET to the two values the export handed over. The Sockets' credentials and invitation links open only under them.`,
    `Set BETTER_AUTH_URL to this deevy's own URL${baseURL ? ` (${url})` : ""}, and register an OAuth App for each sign-in provider with ${url}/api/auth/callback/<provider>: the hosted ones were the platform's. Everybody signs in again and lands on their own account. DEEVY_ADMIN_EMAIL can stay unset: the Workspace's admins came with it.`,
    `Point every Agent's DEEVY_URL and MCP client at ${url} instead of the hosted address. Their API keys still work.`,
    sockets.length > 0
      ? `Point each Socket's tool at its new address:\n${sockets.map((socket) => `       - ${socketStep(socket, url)}`).join("\n")}`
      : null,
    "Once this deevy is up, delete the hosted Workspace, so nothing is written to the copy you left.",
  ].filter((step): step is string => step !== null);
  return `\nNext:\n${steps.map((step, index) => `  ${String(index + 1)}. ${step}`).join("\n")}\n`;
}
