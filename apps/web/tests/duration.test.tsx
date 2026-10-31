import { describe, expect, it } from "vite-plus/test";
import { duration } from "../src/lib/time.ts";

/** How long a Run worked, waited and queued reads (docs/plans/run-usage.md). */
describe("a length of time in words", () => {
  it("says it in the largest units that say it", () => {
    expect(duration(0)).toBe("0 s");
    expect(duration(10_000)).toBe("10 s");
    expect(duration(25 * 60_000)).toBe("25 min");
    expect(duration(60 * 60_000)).toBe("1 h");
    expect(duration(80 * 60_000)).toBe("1 h 20 min");
  });
});
