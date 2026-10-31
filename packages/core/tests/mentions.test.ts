import { describe, expect, it } from "vite-plus/test";
import { extractHandles } from "../src/mentions.ts";

/**
 * The handles a comment names, which is how a comment from the tracker
 * mentions a Member (sockets/apply.ts).
 */
describe("extractHandles", () => {
  it("finds @handles and ignores an email address", () => {
    expect(extractHandles("ping @bob and @carol, not bob@example.com")).toEqual(["bob", "carol"]);
    expect(extractHandles("nothing here")).toEqual([]);
    expect(extractHandles("@bob @bob")).toEqual(["bob"]);
  });
});
