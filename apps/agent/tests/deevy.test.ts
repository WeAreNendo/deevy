import { afterEach, describe, expect, it } from "vite-plus/test";
import { DeevyError, createDeevy } from "../src/deevy.ts";
import { instance, testConfig } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("the client", () => {
  it("is the Agent, and can say which one", async () => {
    const it = await instance();
    closers.push(it.close);

    expect(await it.deevy.me()).toEqual({ memberId: it.planner.id, kind: "agent" });
  });

  it("carries deevy's own word for a refusal, not the status code", async () => {
    const it = await instance();
    closers.push(it.close);
    const issue = await it.assign();

    const refused = await it.deevy.startRun(issue.externalKey).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(DeevyError);
    expect(refused).toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("says NOT_FOUND for a Run that is not there", async () => {
    const it = await instance();
    closers.push(it.close);

    await expect(it.deevy.run("nope")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not ask deevy to mark nothing read", async () => {
    let calls = 0;
    const deevy = createDeevy({
      config: { ...testConfig, key: "k" },
      fetch: async () => {
        calls += 1;
        return new Response("{}");
      },
    });

    expect(await deevy.markRead([])).toBe(0);
    expect(calls).toBe(0);
  });

  it("keeps a body that is not JSON rather than pretending it was", async () => {
    const deevy = createDeevy({
      config: { ...testConfig, key: "k" },
      fetch: async () => new Response("<html>502 from a proxy</html>", { status: 502 }),
    });

    await expect(deevy.me()).rejects.toMatchObject({
      code: "HTTP_502",
      message: "<html>502 from a proxy</html>",
    });
  });
});
