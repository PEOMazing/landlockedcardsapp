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

// Arbitrary pixel values in Tailwind brackets: text-[11px], p-[7px], w-[140px].
// These are the drift. Each one is a decision made in isolation that the next
// person has to either match or quietly contradict.
const ARBITRARY_PX = /\b(?:text|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|top|left|right|bottom|rounded)-\[-?\d+(?:\.\d+)?px\]/g;

function countArbitrary(): { total: number; byFile: Map<string, number> } {
  const byFile = new Map<string, number>();
  let total = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const n = (src.match(ARBITRARY_PX) || []).length;
    if (n > 0) { byFile.set(f, n); total += n; }
  }
  return { total, byFile };
}

// Measured at the time the token layer landed. Lower it, never raise it.
// Worst offenders today: SinglesClient 25, QuickSell 17, InventoryClient 13.
const CEILING = 98;

describe("design tokens: no new drift", () => {
  it("does not add arbitrary pixel values beyond the recorded ceiling", () => {
    const { total, byFile } = countArbitrary();
    const worst = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    assert.ok(
      total <= CEILING,
      `Arbitrary px values rose to ${total} (ceiling ${CEILING}).\n` +
        `Use the spacing scale (var(--s-1..8)) or the type scale (.t-page/.t-section/.t-body/.t-secondary/.t-meta).\n` +
        `Worst offenders:\n${worst.map(([f, n]) => `  ${n}x ${f}`).join("\n")}\n` +
        `If this rise is deliberate, migrate a screen first and lower CEILING instead.`,
    );
  });

  it("the ceiling is not stale by more than a screen's worth", () => {
    // If the real count drops well below the ceiling, the ceiling stops
    // protecting anything: someone could add twenty violations and still pass.
    // This fails to make you tighten it, which is how a ratchet stays a ratchet.
    const { total } = countArbitrary();
    assert.ok(
      CEILING - total <= 15,
      `Arbitrary px values are down to ${total} but the ceiling is still ${CEILING}. ` +
        `Lower CEILING to ${total} so the ratchet keeps holding.`,
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
