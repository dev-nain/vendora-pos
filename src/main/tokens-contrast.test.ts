import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../design/tokens.css", import.meta.url), "utf8");

type Tokens = Map<string, string>;

function blockBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing block ${selector}`);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
  }
  throw new Error(`Unclosed block ${selector}`);
}

function declarations(body: string): Tokens {
  const tokens: Tokens = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return tokens;
}

const light = declarations(blockBody(":root"));
const darkOverrides = declarations(blockBody(':root[data-theme="dark"]'));
const mediaDarkOverrides = declarations(blockBody(':root:not([data-theme="light"])'));
const dark: Tokens = new Map([...light, ...darkOverrides]);

function hex(tokens: Tokens, name: string): string {
  const value = tokens.get(name);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not a 6-digit hex colour (${value ?? "missing"})`);
  }
  return value;
}

function luminance(value: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

const surfaces = ["--color-bg", "--color-bg-surface", "--color-bg-surface-secondary"];

const pairs: [foreground: string, background: string, minimum: number][] = [
  ...["--color-text", "--color-text-secondary", "--color-text-tertiary"].flatMap((text) =>
    surfaces.map((surface): [string, string, number] => [text, surface, TEXT]),
  ),
  ...["--color-text-brand", "--color-text-link", "--color-text-critical"].flatMap((text) =>
    surfaces.map((surface): [string, string, number] => [text, surface, TEXT]),
  ),
  ["--color-text", "--color-bg-surface-hover", TEXT],
  ["--color-text-secondary", "--color-bg-surface-hover", TEXT],
  ["--color-text-tertiary", "--color-bg-surface-hover", TEXT],
  ["--color-text", "--color-bg-surface-active", TEXT],
  ["--color-text", "--color-bg-surface-selected", TEXT],
  ["--color-text-secondary", "--color-bg-surface-selected", TEXT],
  ["--color-text-tertiary", "--color-bg-surface-selected", TEXT],
  ["--color-text-brand", "--color-bg-surface-selected", TEXT],
  ["--color-text", "--color-bg-fill-secondary", TEXT],
  ["--color-text", "--color-bg-fill-secondary-hover", TEXT],
  ["--color-text", "--color-bg-fill-secondary-active", TEXT],
  ["--color-text-on-brand", "--color-bg-fill-brand", TEXT],
  ["--color-text-on-brand", "--color-bg-fill-brand-hover", TEXT],
  ["--color-text-on-brand", "--color-bg-fill-brand-active", TEXT],
  ["--color-text-on-critical", "--color-bg-fill-critical", TEXT],
  ["--color-text-on-critical", "--color-bg-fill-critical-hover", TEXT],
  ["--color-text-on-success", "--color-bg-fill-success", TEXT],
  ["--color-text-on-success", "--color-bg-fill-success-hover", TEXT],
  ["--color-text-on-highlight", "--color-bg-fill-highlight", TEXT],
  ["--color-text-secondary", "--color-bg-fill-neutral-secondary", TEXT],
  ["--color-text-brand", "--color-bg-fill-brand-secondary", TEXT],
  ["--color-text-success", "--color-bg-fill-success-secondary", TEXT],
  ["--color-text-warning", "--color-bg-fill-warning-secondary", TEXT],
  ["--color-text-critical", "--color-bg-fill-critical-secondary", TEXT],
  ["--color-text-success", "--color-bg-surface-success", TEXT],
  ["--color-text-warning", "--color-bg-surface-warning", TEXT],
  ["--color-text-critical", "--color-bg-surface-critical", TEXT],
  ["--color-text", "--color-bg-surface-warning", TEXT],
  ["--color-text", "--color-bg-surface-critical", TEXT],
  ["--color-text", "--color-bg-surface-success", TEXT],
  ["--color-text-success", "--color-bg-surface", TEXT],
  ["--color-text-warning", "--color-bg-surface", TEXT],
  ...["--color-input-border", "--color-border-focus", "--color-border-critical-strong"].flatMap(
    (border) => surfaces.map((surface): [string, string, number] => [border, surface, NON_TEXT]),
  ),
  ...[
    "--color-icon",
    "--color-icon-secondary",
    "--color-icon-success",
    "--color-icon-critical",
  ].flatMap((icon) =>
    surfaces.map((surface): [string, string, number] => [icon, surface, NON_TEXT]),
  ),
  ["--color-icon-warning", "--color-bg-surface-warning", NON_TEXT],
  ["--color-icon-success", "--color-bg-surface-success", NON_TEXT],
  ["--color-icon-critical", "--color-bg-surface-critical", NON_TEXT],
  ["--color-border-focus", "--color-bg-surface-selected", NON_TEXT],
  ["--color-border-focus", "--color-bg-surface-secondary", NON_TEXT],
];

describe("design tokens", () => {
  it("keeps both dark blocks identical", () => {
    expect(Object.fromEntries(mediaDarkOverrides)).toEqual(Object.fromEntries(darkOverrides));
  });

  it("defines every light token in dark too", () => {
    const colourTokens = [...light.keys()].filter(
      (name) => name.startsWith("--color-") || name.startsWith("--shadow-"),
    );
    const themeAgnostic = new Set(["--shadow-focus"]);
    const missing = colourTokens.filter(
      (name) => !themeAgnostic.has(name) && !darkOverrides.has(name),
    );
    expect(missing).toEqual([]);
  });

  for (const [theme, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    describe(`${theme} contrast`, () => {
      it.each(pairs)("%s on %s meets %s:1", (foreground, background, minimum) => {
        const ratio = contrast(hex(tokens, foreground), hex(tokens, background));
        expect(
          ratio,
          `${foreground} on ${background} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(minimum);
      });
    });
  }
});
