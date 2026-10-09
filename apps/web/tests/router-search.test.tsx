import { describe, expect, it, vi } from "vite-plus/test";
import { parseSearch, stringifySearch } from "@/router";
import { mountAt } from "./mount";

/**
 * The router writes the address bar back from what it parsed, so what it
 * parses has to be everything the URL said. Better Auth signs the consent
 * page's query, a repeated `ba_param` included, and checks that signature when
 * the Human answers; a router that kept one value of a repeated key made every
 * consent fail as `invalid_signature`, for an MCP client and `deevy login`.
 */
describe("the router's search", () => {
  it("keeps every value of a key the URL repeats, both ways", () => {
    const search = "?client_id=c&ba_param=client_id&ba_param=scope&ba_param=state&sig=xyz";
    const parsed = parseSearch(search);
    expect(parsed.ba_param).toEqual(["client_id", "scope", "state"]);
    expect(parsed.client_id).toBe("c");
    expect(stringifySearch(parsed)).toBe(search);
  });

  it("leaves the consent page's signed query whole after it loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })),
    );
    const search = "?client_id=c&scope=openid&ba_param=client_id&ba_param=scope&sig=xyz";
    const router = await mountAt(`/consent${search}`);
    expect(router.state.location.searchStr).toBe(search);
    vi.unstubAllGlobals();
  });
});
