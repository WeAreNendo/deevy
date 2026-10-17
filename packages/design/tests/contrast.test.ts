import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/*
 * Every colour the app sets as text, on every ground it puts it on, in both
 * themes, at WCAG AA (4.5:1 for text under 24px, which is all of deevy's).
 * The grounds include the tints the components compose: a Working badge is
 * `bg-agent/10 text-agent`, rose text on rose at 10% over the page, and that
 * pair is what a reader sees, not rose on the bare page.
 */
const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map(
    [...body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name!, value!]),
  );
}

const themes = { light: block(":root"), dark: block('.dark,\n:root[data-theme="dark"]') };
type Theme = keyof typeof themes;
type Rgb = [number, number, number];

/** A token's colour as gamma-encoded sRGB, following `var()` aliases. */
function srgb(theme: Theme, name: string): Rgb {
  const value = themes[theme].get(name);
  if (!value) throw new Error(`--${name} has no value in ${theme}`);
  const alias = /^var\(--([\w-]+)\)$/.exec(value.trim());
  if (alias) return srgb(theme, alias[1]!);
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value.trim());
  if (!match) throw new Error(`--${name} is not an oklch() colour: ${value}`);
  const [L, C, h] = match.slice(1).map(Number) as [number, number, number];
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return linear.map(encode) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b);
}

/** Text on a ground, with a tint of `alpha` over it the way a browser composites it. */
function ratio(theme: Theme, text: string, ground: string, tint?: string, alpha = 0): number {
  let behind = srgb(theme, ground);
  if (tint) {
    const over = srgb(theme, tint);
    behind = behind.map((c, i) => alpha * over[i]! + (1 - alpha) * c) as Rgb;
  }
  const [x, y] = [luminance(srgb(theme, text)), luminance(behind)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** [what it is, text, ground, tint, alpha in light, alpha in dark, themes], from the components. */
const pairs: Array<[string, string, string, string?, number?, number?, Theme[]?]> = [
  ["body text", "foreground", "background"],
  ["text on a card", "card-foreground", "card"],
  ["hints on the page", "muted-foreground", "background"],
  ["hints on a card", "muted-foreground", "card"],
  ["hints in the sidebar", "muted-foreground", "sidebar"],
  ["white on a filled button", "primary-foreground", "primary"],
  ["a link on the page", "link", "background"],
  ["a link on a card", "link", "card"],
  ["a pressed toggle", "link", "background", "primary", 0.1, 0.2],
  ["a Human's initials", "human", "background", "human", 0.15, 0.15],
  ["an Agent's name", "agent", "background"],
  ["a Working badge", "agent", "background", "agent", 0.1, 0.1],
  ["a Finished badge", "state-done", "background", "state-done", 0.1, 0.1],
  ["numbers in code", "state-done", "card"],
  ["a Failed badge", "destructive", "background", "destructive", 0.1, 0.1],
  ["a destructive button", "destructive", "background", "destructive", 0.1, 0.2],
  ["a Waiting badge", "gate-foreground", "background", "gate", 0.15, 0.15, ["light"]],
  ["a Waiting badge", "gate", "background", "gate", 0.15, 0.15, ["dark"]],
];

describe("text in deevy's colours", () => {
  for (const [what, text, ground, tint, light = 0, dark = 0, only] of pairs) {
    for (const theme of only ?? (["light", "dark"] as Theme[])) {
      it(`reads at AA as ${what}, ${theme}`, () => {
        const alpha = theme === "light" ? light : dark;
        expect(ratio(theme, text, ground, tint, alpha)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
