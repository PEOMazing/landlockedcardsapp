import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Keeps the shared primitives shared.
//
// Pulling five copies of a stat tile into one component is the easy half. The
// hard half is that the sixth screen to need a tile will be written by someone
// in a hurry who does not know components/ui exists, and the fastest thing
// available to them is copying the fifth screen. That is exactly how there came
// to be five in the first place, and nobody chose it.
//
// So each of these asserts the absence of the shape that was just removed. They
// are deliberately narrow: they match the specific local-component pattern, not
// anything that merely looks similar, because a check that fires on innocent
// code gets deleted within a week.

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);
// The primitives themselves are allowed to be the thing they are.
const UI_DIR = join("components", "ui");

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !f.startsWith(UI_DIR));

/** A comment line, which is prose about the code rather than the code.
 *  These checks are about what the app does, and a check that fires on a
 *  comment explaining why something was removed is a check that punishes
 *  writing the explanation down. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!isComment(lines[i]) && re.test(lines[i])) out.push(`${f}:${i + 1}`);
    }
  }
  return out;
}

/** Source with comment lines dropped, for asserting about a primitive's own
 *  code. StatTile's header names the old `tone?: string` signature on purpose. */
const codeOf = (path: string) =>
  readFileSync(path, "utf8").split("\n").filter((l) => !isComment(l)).join("\n");

describe("shared primitives are not re-implemented locally", () => {
  it("no screen declares its own stat tile", () => {
    // Structural, not a list of names. The six copies that existed were called
    // Tile, Tile, Tile, Count, Stat and Big, so a name list would have missed
    // the sixth and will miss the seventh. What they all had in common is the
    // shape: a local component whose first prop is a label, rendering the
    // label class above a value. That is the thing to detect.
    const found: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = /^\s*(?:export\s+)?function (\w+)\s*\(\s*\{\s*label\b/.exec(lines[i]);
        if (!m) continue;
        // The body, up to the next top-level close brace.
        const end = lines.findIndex((l, j) => j > i && /^\}/.test(l));
        const body = lines.slice(i, end === -1 ? i + 40 : end).join("\n");
        if (/className="label"/.test(body) && /\bfont-bold\b/.test(body)) {
          found.push(`${f}:${i + 1}  function ${m[1]}`);
        }
      }
    }
    assert.deepEqual(
      found,
      [],
      `Use StatTile from components/ui instead of a local copy:\n  ${found.join("\n  ")}`,
    );
  });

  it("no screen declares its own sortable table header", () => {
    const found = hits(/^\s*(?:export\s+)?function (Th|SortTh|HeaderCell)\s*\(\s*\{/);
    assert.deepEqual(
      found,
      [],
      `Use SortableTh from components/ui instead of a local copy:\n  ${found.join("\n  ")}`,
    );
  });

  it("no empty-state row hardcodes how many columns its table has", () => {
    // A colSpan number is a second copy of the table's shape. It goes stale the
    // next time a column is added, and the only symptom is a message that
    // stops short of the right edge.
    const found = hits(/<td colSpan=\{[^}]+\}\s+className="text-dim"/);
    assert.deepEqual(
      found,
      [],
      `Use TableEmpty, which spans whatever the table currently is:\n  ${found.join("\n  ")}`,
    );
  });

  it("warnings use the warn token, never Tailwind's raw amber", () => {
    // amber-400 is roughly 1.67:1 against a white card. Every warning written
    // that way was invisible in light mode, which is the whole reason this
    // check exists rather than being a style preference: --c-warn is re-picked
    // per theme and clears 5.5:1 on white, 9:1 on the dark panel.
    const found = hits(/\bamber-\d{2,3}\b/);
    assert.deepEqual(
      found,
      [],
      `Use text-warn / border-warn / bg-warn:\n  ${found.join("\n  ")}`,
    );
  });

  it("the primitives exist where the other checks say they do", () => {
    // Without this, deleting components/ui would make every check above pass.
    for (const f of ["StatTile.tsx", "SortableTh.tsx", "TableEmpty.tsx"]) {
      const src = readFileSync(join(UI_DIR, f), "utf8");
      assert.match(src, /export default function/, `${f} must have a default export`);
    }
  });

  it("StatTile takes a semantic tone, not a class name", () => {
    // The old components typed tone as `string`, so call sites passed
    // "text-win" straight through. That is how text-amber-400 got into the
    // palette: a prop that accepts any class makes the palette a suggestion.
    const src = codeOf(join(UI_DIR, "StatTile.tsx"));
    assert.doesNotMatch(src, /tone\?*:\s*string/, "tone must be a union, not string");
    assert.match(src, /export type Tone =/);
  });
});
