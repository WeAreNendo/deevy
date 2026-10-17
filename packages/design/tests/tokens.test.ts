import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { bar, disc, lockupBox, markBox, word, wordAt } from "../src/logo.ts";

const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

/** The custom properties a block declares, by name, in order. */
function declared(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name!, value!]),
  );
}

const light = declared(":root");
const dark = declared(':root[data-theme="dark"]');

/** What does not change with the theme: the faces and the scale. */
const themeless = new Set([
  "--face-sans",
  "--face-mono",
  "--face-display",
  "--radius",
  "--density",
  "--tracking",
]);

describe("the tokens", () => {
  it("give every colour a value in the dark theme too", () => {
    // A colour declared only for light shows light's value on a dark page, which
    // is the one mistake a theme makes without anybody seeing it in review.
    const colours = [...light.keys()].filter((name) => !themeless.has(name));
    expect(colours.filter((name) => !dark.has(name))).toEqual([]);
  });

  it("declare nothing in the dark theme that light lacks", () => {
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it("answer to the app's class and the docs site's attribute with one block", () => {
    expect(css).toMatch(/\.dark,\n:root\[data-theme="dark"\] \{/);
  });
});

describe("the logo's data", () => {
  it("is paths and boxes a viewBox takes", () => {
    for (const path of [disc, bar, word]) expect(path).toMatch(/^M[\d.\s-]/);
    for (const box of [markBox, lockupBox]) {
      const numbers = box.split(" ").map(Number);
      expect(numbers).toHaveLength(4);
      expect(numbers.every(Number.isFinite)).toBe(true);
    }
    expect(Number.isFinite(wordAt.x) && Number.isFinite(wordAt.y)).toBe(true);
  });
});
