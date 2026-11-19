import { describe, expect, it } from "vite-plus/test";
import { parseSearch, stringifySearch } from "@/router";

/**
 * The router writes the address bar back from what it parsed, so what it
 * parses has to be everything the URL said: a link somebody pasted, a key
 * repeated in it included, comes back as it was.
 */
describe("the router's search", () => {
  it("keeps every value of a key the URL repeats, both ways", () => {
    const search = "?project=deevy&status=open&status=waiting&q=xyz";
    const parsed = parseSearch(search);
    expect(parsed.status).toEqual(["open", "waiting"]);
    expect(parsed.project).toBe("deevy");
    expect(stringifySearch(parsed)).toBe(search);
  });
});
