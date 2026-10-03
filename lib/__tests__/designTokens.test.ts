import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The contract that stops design drift.
//
// This is the mechanism that held the PEOLens design system together, and the
// reason it is here is that this codebase demonstrably needed it: before the
// token layer there were 99 inline arbitrary pixel values, six different
// corner radii in use, and more than twenty files hand-rolling their own stat
// tiles. Nobody did that on purpose. It happens one reasonable-looking commit
// at a time, and a test is the only thing that notices.
//
// It is a ratchet, not a wall. The current count is recorded as a ceiling, so
// existing screens can be migrated at their own pace while a NEW off-scale
// value fails the build. Every time a screen moves onto the scale, lower the
// ceiling. The target is zero.

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => {
  try { return walk(r); } catch { return []; }
});

// Two rules, not one, because the original single count lumped together two
// very different things and that is why it needed a ceiling instead of a zero.
//
// A font size or a margin written in raw pixels is drift: there is a scale for
// it, the scale has a right answer, and the only reason the pixel value exists
// is that the person writing it did not know the step. The app had six distinct
// micro font sizes (8, 9, 10, 11, 13, 15 pixels) doing the work of one.
//
// A dimension is not drift. `max-w-[1600px]` on the page container, and
// `max-w-[150px]` clamping a product name before it pushes the price column off
// screen, are measurements of a layout, not choices from a palette. There is no
// dimension scale for them to belong to, and inventing a six-step one so a test
// could go green would be worse than the thing the test is meant to prevent.
// So those are left alone, deliberately, and this file says so out loud rather
// than carrying them silently in a ceiling.
const OFF_SCALE_TYPE = /\btext-\[\d+(?:\.\d+)?px\]/g;
const OFF_SCALE_SPACING =
  /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[-?\d+(?:\.\d+)?px\]/g;

// Prose about the code is not the code. Without this, a comment explaining why
// an 8 pixel font size was removed counts as an 8 pixel font size.
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function find(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      for (const m of lines[i].match(re) || []) out.push(`${f}:${i + 1}  ${m}`);
    }
  }
  return out;
}

describe("design tokens: no new drift", () => {
  // These were a ceiling of 98 when the token layer landed, because 98 of them
  // existed. They are zero now, so they are asserted as zero. A ceiling that
  // can be reached is better than a ceiling that has to be maintained: nobody
  // has to remember to lower it, and the failure message is unambiguous.
  it("no font size is written in raw pixels", () => {
    const found = find(OFF_SCALE_TYPE);
    assert.deepEqual(
      found,
      [],
      "The type scale has a step for each of these. Use .t-page, .t-section, " +
        ".t-body, .t-secondary, .t-meta, or .label for an uppercase micro label:\n  " +
        found.join("\n  "),
    );
  });

  it("no padding, margin or gap is written in raw pixels", () => {
    const found = find(OFF_SCALE_SPACING);
    assert.deepEqual(
      found,
      [],
      "Use the spacing scale: p-s1 through p-s8, which are 4 / 8 / 12 / 16 / 24 / 32:\n  " +
        found.join("\n  "),
    );
  });
});

describe("design tokens: the token layer stays intact", () => {
  const tokens = readFileSync("app/tokens.css", "utf8");

  it("defines both themes", () => {
    assert.match(tokens, /:root\[data-theme="light"\]/);
    assert.match(tokens, /:root\[data-theme="dark"\]/);
  });

  it("every colour token is defined in both themes", () => {
    // A token present in dark but missing in light is invisible until someone
    // opens that screen in daylight and finds a transparent element.
    const names = (block: string) =>
      new Set([...block.matchAll(/--c-([a-z-]+):/g)].map((m) => m[1]));
    const darkBlock = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'), tokens.indexOf(':root[data-theme="light"]'));
    const lightBlock = tokens.slice(tokens.indexOf(':root[data-theme="light"]'));
    const dark = names(darkBlock);
    const light = names(lightBlock);
    const missing = [...dark].filter((n) => !light.has(n));
    assert.deepEqual(missing, [], `Defined in dark but not light: ${missing.join(", ")}`);
  });

  it("colours are raw RGB channels, not hex, so opacity modifiers keep working", () => {
    // bg-foil/15 compiles to rgb(var(--c-foil) / 0.15). A hex value there
    // silently drops the alpha and roughly 200 call sites lose their tint.
    const decls = [...tokens.matchAll(/--c-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1].trim());
    const bad = decls.filter((d) => !/^\d+\s+\d+\s+\d+$/.test(d));
    assert.deepEqual(bad, [], `These must be "R G B" channel triples: ${bad.join(" | ")}`);
  });

  it("keeps the spacing scale to six steps and the radius scale to two", () => {
    const spacing = [...tokens.matchAll(/--s-\d+:/g)].length;
    const radius = [...tokens.matchAll(/--r-(?:sm|md):/g)].length;
    assert.equal(spacing, 6, "spacing scale should be 4/8/12/16/24/32");
    assert.equal(radius, 2, "the blueprint specifies two radii (6 and 10)");
  });

  it("has exactly one shadow level, because cards use a 1px border instead", () => {
    const shadows = [...tokens.matchAll(/^\s*--shadow[a-z-]*:/gm)].length;
    // One in :root plus one light-mode override of the same token.
    assert.ok(shadows <= 2, `found ${shadows} shadow tokens; the blueprint allows one`);
  });

  it("no screen reaches past that one level for a Tailwind shadow", () => {
    // Defining one shadow token means nothing while eight overlays still use
    // shadow-2xl. That was the actual state: the token existed and the app
    // ignored it. `lifted` is the only way to raise something off the page.
    const found = find(/\bshadow-(sm|md|lg|xl|2xl|inner)\b/);
    assert.deepEqual(
      found,
      [],
      "Use the `lifted` class, which is the one shadow level, and only on an " +
        "overlay. A card is a 1px border:\n  " + found.join("\n  "),
    );
  });
});

describe("design tokens: the app is usable from a keyboard", () => {
  const globals = readFileSync("app/globals.css", "utf8");

  it("every control gets a focus ring from one global rule", () => {
    // Not a nice-to-have. Before this rule there were 210 buttons in the app
    // and one focus style between them, so tabbing through the inventory table
    // moved an invisible cursor. The rule is global rather than per component
    // precisely because 157 of those buttons are plain text buttons that will
    // never carry a .btn class.
    assert.match(globals, /:focus-visible\s*\{/);
    assert.match(globals, /outline:\s*2px solid rgb\(var\(--c-foil\)\)/);
  });

  it("uses focus-visible rather than focus, so a mouse click leaves no ring", () => {
    const plainFocus = [...globals.matchAll(/[^-]\bbutton[^{]*:focus\s*\{/g)].length;
    assert.equal(plainFocus, 0, "style :focus-visible, not :focus");
  });
});

describe("design tokens: no hardcoded canvas colours", () => {
  it("globals.css reads the canvas from tokens", () => {
    const g = readFileSync("app/globals.css", "utf8");
    // The old stylesheet had `background: #0D0F14` on body, which is exactly
    // what makes a theme switch leave the old colour behind.
    const bodyRule = g.slice(g.indexOf("body {"), g.indexOf("}", g.indexOf("body {")));
    assert.match(bodyRule, /rgb\(var\(--c-ink\)\)/);
    assert.doesNotMatch(bodyRule, /#[0-9a-fA-F]{6}/);
  });
});
