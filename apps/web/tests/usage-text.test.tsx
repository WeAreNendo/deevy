import { describe, expect, it } from "vite-plus/test";
import { dollars, duration, harnessesOf, tokens } from "../src/lib/usage.ts";

/** How a Run's usage and time read (docs/plans/run-usage.md). */
describe("usage in words", () => {
  it("says a length of time in the largest units that say it", () => {
    expect(duration(0)).toBe("0 s");
    expect(duration(10_000)).toBe("10 s");
    expect(duration(25 * 60_000)).toBe("25 min");
    expect(duration(60 * 60_000)).toBe("1 h");
    expect(duration(80 * 60_000)).toBe("1 h 20 min");
  });

  it("keeps the digits a small cost needs, and two for the rest", () => {
    // A session's cost often sits below a cent: "$0.02" would say less than
    // the harness did.
    expect(dollars(0.021144)).toBe("$0.0211");
    expect(dollars(0.5)).toBe("$0.50");
    expect(dollars(1.3)).toBe("$1.30");
    expect(dollars(1234.5)).toBe("$1,234.50");
  });

  it("reads token counts the way a person does", () => {
    expect(tokens(12)).toBe("12");
    expect(tokens(1_500)).toBe("1.5K");
    expect(tokens(273_800)).toBe("274K");
  });

  it("names the harnesses whose estimate a cost is, once each", () => {
    expect(harnessesOf([{ harness: "claude-code" }, { harness: "claude-code" }])).toBe(
      "Claude Code",
    );
    expect(harnessesOf([{ harness: "claude-code" }, { harness: "cursor" }])).toBe(
      "Claude Code and Cursor",
    );
    expect(harnessesOf([{ harness: "my-own" }])).toBe("my-own");
  });
});
