import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  bundledConfig,
  manifest,
  parseJsonc,
  placeholders,
  settings,
  tar,
  template,
  token,
} from "../scripts/artifact.ts";

/**
 * What a release ships of the hosted Worker (scripts/artifact.ts). The archive
 * itself is built and dry-run by `vp run hosted#package` and `hosted#check:hosted`;
 * these hold the pieces it is made of to what the manifest promises.
 */

const app = join(import.meta.dirname, "..");
const committed = readFileSync(join(app, "wrangler.jsonc"), "utf8");

function at(value: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce<unknown>((into, key) => (into as Record<string, unknown> | undefined)?.[key], value);
}

describe("wrangler.jsonc, read without wrangler", () => {
  it("loses its comments and trailing commas and keeps its strings", () => {
    const text = `{
      // a comment
      "url": "https://example.com/a//b", /* another */
      "odd": "a,} and \\" quote",
      "list": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({
      url: "https://example.com/a//b",
      odd: 'a,} and " quote',
      list: [1, 2],
    });
  });
});

describe("the wrangler.json a release carries", () => {
  const shipped = template(committed);

  it("deploys the bundle beside it as it is, with the SPA beside that", () => {
    expect(shipped).toMatchObject({
      name: "deevy-hosted",
      main: "worker.js",
      no_bundle: true,
      find_additional_modules: false,
      assets: { directory: "client", binding: "ASSETS", run_worker_first: true },
    });
    expect(shipped).not.toHaveProperty("define");
    expect(shipped).not.toHaveProperty("$schema");
  });

  it("keeps what the committed configuration binds, the Durable Object and its migrations", () => {
    const source = parseJsonc(committed) as Record<string, unknown>;
    expect(shipped.compatibility_date).toBe(source.compatibility_date);
    expect(shipped.compatibility_flags).toEqual(source.compatibility_flags);
    expect(shipped.durable_objects).toEqual(source.durable_objects);
    expect(shipped.migrations).toEqual(source.migrations);
  });

  it("marks every blank the manifest names, where it says, and no other", () => {
    for (const placeholder of placeholders) {
      for (const pointer of placeholder.at) {
        expect(at(shipped, pointer), pointer).toContain(token(placeholder.name));
      }
    }
    const blanks = [...JSON.stringify(shipped).matchAll(/<<([A-Z_]+)>>/g)].map((m) => m[1]);
    expect(new Set(blanks)).toEqual(new Set(placeholders.map((one) => one.name)));
  });

  it("holds no secret", () => {
    const text = JSON.stringify(shipped);
    for (const secret of settings.filter((one) => one.kind === "secret")) {
      expect(text).not.toContain(`"${secret.name}"`);
    }
  });

  it("is what the smoke and the walk run, less the deployer's blanks", () => {
    const local = bundledConfig(committed);
    expect(local.kv_namespaces).toEqual([{ binding: "DIRECTORY" }]);
    expect(local).not.toHaveProperty("routes");
    expect(local).not.toHaveProperty("services");
  });
});

describe("the manifest", () => {
  it("names every variable the Worker reads, but the development stubs", () => {
    const declared = (path: string, name: string) => {
      const source = readFileSync(join(app, path), "utf8");
      const body =
        new RegExp(`interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
      return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]+)\??:/gm)].map((match) => match[1] ?? "");
    };
    const bindings = new Set(["WORKSPACES", "DIRECTORY", "ASSETS", "CONSOLE", "EMAIL"]);
    const reads = [
      ...declared("src/env.ts", "HostedBindings"),
      ...declared("../../packages/core/src/provider-env.ts", "ProviderVariables"),
    ].filter((name) => !bindings.has(name) && !name.startsWith("DEEVY_DEV_STUB_"));
    expect(reads.length).toBeGreaterThan(20);
    expect(settings.map((one) => one.name).sort()).toEqual([...new Set(reads)].sort());
  });

  it("hashes every file, and says what the deployer adds", () => {
    const bytes = new TextEncoder().encode("hello");
    const described = manifest({
      version: "1.2.3",
      commit: "abc",
      config: template(committed),
      files: [{ path: "worker.js", bytes }],
    });
    expect(described.files).toEqual({
      "worker.js": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(described).toMatchObject({
      format: 1,
      version: "1.2.3",
      durableObjects: [{ binding: "WORKSPACES", className: "WorkspaceObject" }],
      migrations: [{ tag: "v1" }],
    });
    expect(described.secrets.filter((one) => one.required).map((one) => one.name)).toEqual([
      "DEEVY_HOSTED_MASTER_SECRET",
      "DEEVY_SIGN_IN_RELAY_SECRET",
    ]);
  });
});

describe("the archive", () => {
  const encoder = new TextEncoder();
  const deep = `client/${"assets/".repeat(15)}${"x".repeat(90)}.js`;
  const files = [
    { path: "worker.js", bytes: encoder.encode("export default {};\n") },
    { path: deep, bytes: encoder.encode("a".repeat(1000)) },
    { path: "client/index.html", bytes: new Uint8Array(0) },
  ];

  it("is the same bytes for the same files", () => {
    expect(tar(files, 1_700_000_000)).toEqual(tar([...files].reverse(), 1_700_000_000));
  });

  it("is one the system's tar reads back, long paths included", () => {
    const dir = mkdtempSync(join(tmpdir(), "deevy-tar-"));
    try {
      const archive = join(dir, "a.tar");
      writeFileSync(archive, tar(files, 1_700_000_000));
      const listed = execFileSync("tar", ["-tf", archive], { encoding: "utf8" });
      expect(listed.trim().split("\n").sort()).toEqual(files.map((file) => file.path).sort());
      execFileSync("tar", ["-xf", archive, "-C", dir]);
      for (const file of files) {
        expect(new Uint8Array(readFileSync(join(dir, file.path)))).toEqual(file.bytes);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
