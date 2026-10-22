import { user } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { describeError, withoutBoundValues } from "../src/errors.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** A row whose every value is easy to look for in a log line. */
const grace = {
  id: "usr_gracerecog1",
  name: "Grace Recognisable",
  email: "grace.recognisable@example.com",
};

/** What a write of that row twice throws, on the driver this run is for. */
async function failedWrite(): Promise<DrizzleQueryError> {
  const { db, close } = testDb();
  closers.push(close);
  await db.insert(user).values(grace);
  const failure = await db
    .insert(user)
    .values({ ...grace, email: "grace.again@example.com" })
    .then(() => null)
    .catch((error: unknown) => error);
  if (!(failure instanceof DrizzleQueryError)) throw new Error("the second write did not fail");
  return failure;
}

/**
 * deevy Cloud's logs promise nothing from a Workspace's database
 * (apps/docs/content/cloud/support.md), and a failed query's own message is
 * the SQL followed by every value bound to it.
 */
describe("an error said for a log that is not the Workspace's", () => {
  it("names a failed query's SQL and SQLite's reason, and none of the row", async () => {
    const failure = await failedWrite();
    // What a log of the error itself would carry: the row it was writing.
    expect(failure.message).toContain("grace.again@example.com");
    expect(failure.stack).toContain(grace.name);

    const said = describeError(failure);
    expect(said).toMatch(/^DrizzleQueryError: insert into "user" \(.+\) values \(.+\), caused by /);
    expect(said).toContain("UNIQUE constraint failed: user.id");
    expect(said).toMatch(/\n\s+at /);
    for (const value of [grace.id, grace.name, grace.email, "grace.again@example.com"]) {
      expect(said).not.toContain(value);
    }
  });

  it("follows the chain an operation's failure arrives in", async () => {
    const failure = await failedWrite();
    const said = describeError(
      new ORPCError("INTERNAL_SERVER_ERROR", { message: grace.email, cause: failure }),
    );
    expect(said).toMatch(/^ORPCError INTERNAL_SERVER_ERROR, caused by DrizzleQueryError: insert/);
    expect(said).not.toContain(grace.email);
  });

  it("leaves out any other message, which may have come from the database too", () => {
    const said = describeError(new TypeError(`The ${grace.name} Socket is not a tracker`));
    expect(said).toMatch(/^TypeError\n\s+at /);
    expect(said).not.toContain(grace.name);
    expect(describeError(grace.email)).toBe("a thrown string");
  });

  /**
   * Not even the engine's own messages are kept, by class or by shape: V8
   * writes the value it was handed into a TypeError, a RangeError and a
   * SyntaxError alike, and the most common TypeError of all names a key that
   * may have been computed from a row.
   */
  it("leaves out the engine's messages too, which quote the values they were handed", () => {
    const thrownBy = (attempt: () => unknown): unknown => {
      try {
        attempt();
      } catch (error) {
        return error;
      }
      throw new Error("it did not throw");
    };
    const rows: Record<string, { name: string }> | undefined = undefined;
    const engine = [
      thrownBy(() => rows![grace.email]!.name),
      thrownBy(() => "getResponse" in (grace.email as unknown as object)),
      thrownBy(() => JSON.parse(grace.email)),
      thrownBy(() => BigInt(Number.parseFloat("1.5"))),
    ];
    expect(engine.map((error) => (error as Error).name)).toEqual([
      "TypeError",
      "TypeError",
      "SyntaxError",
      "RangeError",
    ]);
    // What each would have said.
    expect((engine[0] as Error).message).toContain(grace.email);
    expect((engine[1] as Error).message).toContain(grace.email);
    // JSON.parse quotes the start of its input.
    expect((engine[2] as Error).message).toContain("grace.reco");
    expect((engine[3] as Error).message).toContain("1.5");
    for (const error of engine) {
      const said = describeError(error);
      expect(said).toMatch(/^(TypeError|SyntaxError|RangeError)\n\s+at /);
      expect(said).not.toContain("grace.reco");
      expect(said).not.toContain("1.5");
    }
  });

  it("cuts the values from a failed query's message, for a library that logs one", async () => {
    const failure = await failedWrite();
    const cut = withoutBoundValues(failure.message);
    expect(cut).toMatch(/^Failed query: insert into "user"/);
    expect(cut).not.toContain(grace.email);
    expect(withoutBoundValues("Unable to create OAuth user")).toBe("Unable to create OAuth user");
  });
});
