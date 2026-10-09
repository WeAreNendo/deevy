/**
 * What a release of the hosted Worker is (docs/plans/hosted.md slice 13): the
 * bundle, the SPA it serves, a `wrangler.json` to deploy the two with, and a
 * manifest saying what is inside and what the deployer must add. The private
 * control plane deploys this and never builds deevy itself (C2), so whatever
 * it needs to know about the open-source half is written here, by the build,
 * rather than read out of this repository.
 *
 * Plain functions over bytes and text; scripts/package.ts reads the files and
 * writes the tarball, and tests/artifact.test.ts holds these to their word.
 */
import { createHash } from "node:crypto";

/** The parts of a wrangler configuration this file reads or writes. */
export interface WranglerConfig {
  name: string;
  main?: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  assets?: { directory?: string; binding?: string; [key: string]: unknown };
  durable_objects?: { bindings: Array<{ name: string; class_name: string }> };
  migrations?: Array<{ tag: string; [key: string]: unknown }>;
  kv_namespaces?: Array<{ binding: string; id?: string }>;
  services?: Array<{ binding: string; service: string; entrypoint?: string }>;
  vars?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * The JSON in a JSONC file: comments and trailing commas gone, strings left
 * exactly as written. wrangler.jsonc is the only JSONC this reads, and a
 * parser of its own keeps the release's tooling to Node's built-ins.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let comma = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? "";
    const next = text[i + 1];
    if (char === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (/\s/.test(char)) {
      out += char;
      continue;
    }
    // A comma is written only once the next thing is known not to close.
    if (comma && char !== "}" && char !== "]") out += ",";
    comma = false;
    if (char === ",") {
      comma = true;
      continue;
    }
    if (char === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end;
      continue;
    }
    out += char;
  }
  return JSON.parse(out);
}

/**
 * The committed wrangler.jsonc as it deploys a bundle that is already built:
 * `main` is that bundle, wrangler must not bundle it again, the SPA is the
 * directory beside it, and the source map goes up with it so a stack trace
 * names deevy's files. The bundle is the whole Worker: without
 * `find_additional_modules: false` an unbundled deploy also uploads every file
 * under it a module rule matches, the SPA's index.html among them. `define` is
 * already inside the bundle, and `$schema` names a node_modules the deployer
 * does not have.
 */
export function bundledConfig(source: string): WranglerConfig {
  const config = { ...(parseJsonc(source) as WranglerConfig) };
  delete config.$schema;
  delete config.define;
  return {
    ...config,
    main: "worker.js",
    no_bundle: true,
    find_additional_modules: false,
    upload_source_maps: true,
    assets: { ...config.assets, directory: "client" },
  };
}

/** Something only the deployer knows, written into wrangler.json as `<<NAME>>`. */
export interface Placeholder {
  name: string;
  description: string;
  /** JSON pointers to every string in wrangler.json the token is part of. */
  at: string[];
  required: boolean;
}

export const placeholders: Placeholder[] = [
  {
    name: "HOST",
    description:
      "The host every Workspace lives on, such as app.example.com: the Worker's Custom Domain, and the origin it gives every Workspace's URL.",
    at: ["/routes/0/pattern", "/vars/DEEVY_HOSTED_ORIGIN"],
    required: true,
  },
  {
    name: "DIRECTORY_KV_ID",
    description:
      "The id of the KV namespace that maps a Workspace's slug to its object, created once and kept: losing it loses every Workspace's address.",
    at: ["/kv_namespaces/0/id"],
    required: true,
  },
  {
    name: "CONSOLE_SERVICE",
    description:
      "The Worker that answers the host's root and the console's paths, bound as CONSOLE and calling back through the Platform entrypoint. Remove the entry to run with no console: the root is then a 404.",
    at: ["/services/0/service"],
    required: false,
  },
];

export function token(name: string): string {
  return `<<${name}>>`;
}

/**
 * The wrangler.json a release carries: the bundled configuration with the
 * deployer's blanks marked, and nothing secret in it. Every secret is set on
 * the deployment (`wrangler versions secret put`), never written here.
 */
export function template(source: string): WranglerConfig {
  const config = bundledConfig(source);
  return {
    ...config,
    routes: [{ pattern: token("HOST"), custom_domain: true }],
    kv_namespaces: (config.kv_namespaces ?? []).map((namespace) =>
      namespace.binding === "DIRECTORY"
        ? { ...namespace, id: token("DIRECTORY_KV_ID") }
        : namespace,
    ),
    services: [{ binding: "CONSOLE", service: token("CONSOLE_SERVICE") }],
    vars: { ...config.vars, DEEVY_HOSTED_ORIGIN: `https://${token("HOST")}` },
  };
}

/** A secret or a variable the hosted Worker reads (src/env.ts), and what it is for. */
export interface Setting {
  name: string;
  /** A secret is set on the deployment; a var may sit in wrangler.json. */
  kind: "secret" | "var";
  required: boolean;
  description: string;
}

const providers: Array<[prefix: string, name: string, id: string, extra: Setting[]]> = [
  ["GITHUB", "GitHub", "github", []],
  ["GOOGLE", "Google", "google", []],
  [
    "GITLAB",
    "GitLab",
    "gitlab",
    [
      {
        name: "GITLAB_ISSUER",
        kind: "var",
        required: false,
        description: "A self-managed GitLab's origin; gitlab.com when unset.",
      },
    ],
  ],
  [
    "MICROSOFT",
    "Microsoft",
    "microsoft",
    [
      {
        name: "MICROSOFT_TENANT_ID",
        kind: "var",
        required: false,
        description: "common, organizations, or one tenant's id; common when unset.",
      },
    ],
  ],
  ["LINEAR", "Linear", "linear", []],
  ["SLACK", "Slack", "slack", []],
  ["ATLASSIAN", "Atlassian", "atlassian", []],
  [
    "DEEVY_OIDC",
    "an OpenID Connect provider",
    "oidc",
    [
      {
        name: "DEEVY_OIDC_ISSUER",
        kind: "var",
        required: false,
        description: "The OpenID Connect issuer, with the client id and secret: all three or none.",
      },
      {
        name: "DEEVY_OIDC_NAME",
        kind: "var",
        required: false,
        description: "What the sign-in button calls that provider; Single sign-on when unset.",
      },
    ],
  ],
];

export const settings: Setting[] = [
  {
    name: "DEEVY_HOSTED_MASTER_SECRET",
    kind: "secret",
    required: true,
    description:
      "32 or more random characters every Workspace's two secrets are derived from, with its object's key. Never changed in place.",
  },
  {
    name: "DEEVY_SIGN_IN_RELAY_SECRET",
    kind: "secret",
    required: true,
    description:
      "32 or more random characters signing where a sign-in's callback may go (ADR-0030).",
  },
  {
    name: "DEEVY_HOSTED_ORIGIN",
    kind: "var",
    required: true,
    description: `The origin every Workspace lives under, https://${token("HOST")} in wrangler.json.`,
  },
  {
    name: "DEEVY_HOSTED_JURISDICTION",
    kind: "var",
    required: false,
    description:
      "Where each Workspace's object is created, eu in wrangler.json; fixed for an object once it is.",
  },
  ...providers.flatMap(([prefix, name, id, extra]): Setting[] => [
    {
      name: `${prefix}_CLIENT_ID`,
      kind: "secret",
      required: false,
      description: `Sign-in with ${name}, with the secret below; its App's callback is https://${token("HOST")}/auth/callback/${id}. Nobody signs in without one provider at least.`,
    },
    {
      name: `${prefix}_CLIENT_SECRET`,
      kind: "secret",
      required: false,
      description: `The secret of that ${name} App, held by the relay.`,
    },
    ...extra,
  ]),
  {
    name: "DEEVY_EMAIL_SENDER",
    kind: "var",
    required: false,
    description:
      "The platform's sender (cloudflare, resend, postmark, sendgrid, mailgun or ses), with the variables that sender reads (docs/OPERATIONS.md, Email). No email without one.",
  },
  {
    name: "DEEVY_EMAIL_FROM",
    kind: "var",
    required: false,
    description: "The From address, on a domain the sender has verified. Required with a sender.",
  },
  {
    name: "DEEVY_HOSTED_PASS_SECONDS",
    kind: "var",
    required: false,
    description: "How often an idle Workspace's alarm does its background work; 60.",
  },
  {
    name: "DEEVY_STREAM_SECONDS",
    kind: "var",
    required: false,
    description: "How long a live Event stream stays open before the browser resumes it; 300.",
  },
  {
    name: "DEEVY_RUN_STALE_MINUTES",
    kind: "var",
    required: false,
    description: "The silence after which a Run is stale; 30.",
  },
  {
    name: "DEEVY_GATE_REMINDER_HOURS",
    kind: "var",
    required: false,
    description: "How often an undecided Gate asks its approvers again; 4.",
  },
  {
    name: "DEEVY_SOCKET_CATCHUP_MINUTES",
    kind: "var",
    required: false,
    description: "How long a connected tool may say nothing before it is asked what changed; 30.",
  },
  {
    name: "DEEVY_GITHUB_API",
    kind: "var",
    required: false,
    description: "A GitHub Enterprise Server's API root, for every GitHub Socket; api.github.com.",
  },
];

/** What the manifest says, and the shape a deployer may rely on while `format` is 1. */
export interface Manifest {
  format: 1;
  name: string;
  version: string;
  commit: string;
  main: string;
  assets: string;
  config: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  durableObjects: Array<{ binding: string; className: string }>;
  migrations: Array<{ tag: string; [key: string]: unknown }>;
  placeholders: Placeholder[];
  secrets: Setting[];
  vars: Setting[];
  /** SHA-256 of every other file in the archive, by its path there. */
  files: Record<string, string>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function manifest(input: {
  version: string;
  commit: string;
  config: WranglerConfig;
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>;
}): Manifest {
  const { config } = input;
  return {
    format: 1,
    name: config.name,
    version: input.version,
    commit: input.commit,
    main: config.main ?? "worker.js",
    assets: config.assets?.directory ?? "client",
    config: "wrangler.json",
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [],
    durableObjects: (config.durable_objects?.bindings ?? []).map((binding) => ({
      binding: binding.name,
      className: binding.class_name,
    })),
    migrations: config.migrations ?? [],
    placeholders,
    secrets: settings.filter((setting) => setting.kind === "secret"),
    vars: settings.filter((setting) => setting.kind === "var"),
    files: Object.fromEntries(
      [...input.files]
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((file) => [file.path, sha256(file.bytes)]),
    ),
  };
}

// ------------------------------------------------------------------- the tar

const encoder = new TextEncoder();

function field(block: Uint8Array, offset: number, length: number, text: string): void {
  const bytes = encoder.encode(text);
  if (bytes.length > length) throw new Error(`"${text}" does not fit a tar header`);
  block.set(bytes, offset);
}

function octal(block: Uint8Array, offset: number, length: number, value: number): void {
  field(block, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

/** A path as ustar holds one: up to 155 bytes of directory, then up to 100 of name. */
function split(path: string): [prefix: string, name: string] {
  if (encoder.encode(path).length <= 100) return ["", path];
  for (let cut = path.indexOf("/"); cut !== -1; cut = path.indexOf("/", cut + 1)) {
    const prefix = path.slice(0, cut);
    const name = path.slice(cut + 1);
    if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) {
      return [prefix, name];
    }
  }
  throw new Error(`${path} is too long for a ustar archive`);
}

function header(path: string, size: number, mtime: number): Uint8Array {
  const block = new Uint8Array(512);
  const [prefix, name] = split(path);
  field(block, 0, 100, name);
  octal(block, 100, 8, 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, size);
  octal(block, 136, 12, mtime);
  block.fill(0x20, 148, 156);
  field(block, 156, 1, "0");
  field(block, 257, 6, "ustar\0");
  field(block, 263, 2, "00");
  field(block, 345, 155, prefix);
  const sum = block.reduce((total, byte) => total + byte, 0);
  field(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

/**
 * A POSIX ustar archive of these files, and the same bytes for the same files:
 * sorted by path, owned by nobody, every one dated `mtime` (seconds), which
 * the build sets to its commit's time. Regular files only; `tar` makes the
 * directories on the way out.
 */
export function tar(
  files: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  mtime: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    parts.push(header(file.path, file.bytes.length, mtime), file.bytes);
    const padding = (512 - (file.bytes.length % 512)) % 512;
    if (padding > 0) parts.push(new Uint8Array(padding));
  }
  // The end of the archive is two empty blocks.
  parts.push(new Uint8Array(1024));
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    archive.set(part, offset);
    offset += part.length;
  }
  return archive;
}
