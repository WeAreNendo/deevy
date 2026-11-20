import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): Promise<string> => readFile(path.join(root, file), "utf8");
const exists = (file: string): boolean => existsSync(path.join(root, file));

interface Manifest {
  scripts?: Record<string, string>;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const manifest = async (dir: string): Promise<Manifest> =>
  JSON.parse(await read(`${dir}/package.json`)) as Manifest;
const dependsOn = (pkg: Manifest): string[] =>
  Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

/**
 * deevy is deployed two ways (ADR-0037): the image, which runs apps/server on
 * node:sqlite, and the hosted Worker, which runs apps/hosted with a Workspace
 * in each Durable Object. The single-Workspace Worker on D1 was a third, and
 * these say it is gone rather than left behind: its build, its adapter, its
 * migrations, its checks and its leg of the walk.
 */
describe("two deployment shapes", () => {
  it("builds the SPA once, for both, and no Worker of its own", async () => {
    const web = await manifest("apps/web");
    expect(Object.keys(web.scripts ?? {}).filter((name) => /workers/.test(name))).toEqual([]);
    expect(dependsOn(web).filter((name) => /wrangler|^@cloudflare\//.test(name))).toEqual([]);
    expect(exists("apps/web/wrangler.jsonc")).toBe(false);
    expect(exists("apps/web/src/worker.ts")).toBe(false);
    // What the hosted Worker serves as every Workspace's assets is what
    // `vp run web#build` writes, the same files the image serves.
    expect(await read("apps/hosted/wrangler.jsonc")).toContain('"directory": "../web/dist",');
  });

  it("adapts the core to Node and to a Durable Object, and to no D1", async () => {
    const adapters = await manifest("packages/adapters");
    expect(Object.keys(adapters.exports ?? {}).sort()).toEqual([
      "./durable",
      "./node",
      "./package.json",
      "./spa",
      "./testing",
    ]);
    const db = await manifest("packages/db");
    expect(Object.keys(db.scripts ?? {}).filter((name) => /d1/.test(name))).toEqual([]);
    expect(dependsOn(db)).not.toContain("wrangler");
    // The rendering wrangler applied to a D1 database. A Durable Object takes
    // its own, as a module (packages/db/src/durable-migrations.ts).
    expect(exists("packages/db/migrations")).toBe(false);
    const server = await manifest("apps/server");
    expect(Object.keys(server.scripts ?? {}).filter((name) => /d1/.test(name))).toEqual([]);
  });

  it("checks both on every commit, and builds nothing else", async () => {
    for (const file of [".github/workflows/ci.yml", ".husky/pre-push"]) {
      const source = await read(file);
      expect({ file, gone: source.match(/web#[\w:-]*workers|check:d1\S*|m3-acceptance/g) }).toEqual(
        {
          file,
          gone: null,
        },
      );
    }
    // The hosted Worker's build is what catches a `node:` import in the core
    // now, so it runs on every commit; its smoke and the walk run beside it.
    const ci = await read(".github/workflows/ci.yml");
    for (const step of ["hosted#build:hosted", "hosted#test:hosted", "acceptance#walk"]) {
      expect(ci).toContain(`vp run ${step}`);
    }
    expect(exists("docs/m3-acceptance.md")).toBe(false);
  });

  it("walks an Agent through the image, the image under a path, and a hosted Workspace", async () => {
    const boot = await read("tools/acceptance/src/boot.ts");
    const starts = [...boot.matchAll(/export async function (start\w+)/g)].map((m) => m[1]);
    expect(starts.sort()).toEqual(["startHosted", "startNode"]);
  });
});
