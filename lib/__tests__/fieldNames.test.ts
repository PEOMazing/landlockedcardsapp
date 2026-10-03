import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Airtable field names have to be spelled the way the base spells them.
//
// Asking for a field that does not exist does not return that field as empty.
// Airtable rejects the whole request, so one wrong name in a `fields[]`
// projection costs every record, not one column. Paired with the `.catch(() =>
// [])` this codebase uses to stop one failing section taking a page down, the
// result is a screen that is confidently, silently blank.
//
// That is how the command palette shipped with no cards in it: the projection
// asked for "Set" and the field is "Set Name". Nothing threw, nothing logged,
// and the products and shows beside it loaded fine, so it looked like it
// worked. It was written twice in the one file, in the projection and in the
// mapping underneath, so it was perfectly self-consistent.
//
// WHAT THIS CAN AND CANNOT DO. There is no schema to check against offline, so
// this is a heuristic, and the honest statement of it is: a name asked for in
// a projection should be a name used as a field somewhere else. "Used as a
// field" is the load-bearing part. Two earlier versions of this file were
// wrong in opposite directions and both are worth not repeating:
//
//   counting occurrences       - the typo appeared twice in its own file and
//                                looked as established as anything real
//   counting any quoted string - "Set" is also a CSV header and an aria-label
//                                in this app, so the typo looked known
//
// So: field-like contexts only, across files, with the handful of genuinely
// single-file fields listed below by name. That list is the maintenance cost
// of the check and it is deliberately short enough to read.

const ROOTS = ["app", "lib", "components"];
const SKIP = new Set(["node_modules", ".next", "__tests__"]);

// Real fields that only one file has any reason to touch. Each was checked
// against the live base when it was added here. A new entry should be rare
// and should be the result of looking, not of making the test pass.
const SINGLE_FILE_FIELDS = new Set([
  "Printed Bucket", // the re-sticker bucket, written only by labels-printed
  "Label Printed",  // stamped only by the slots repair
  "Card Rec Id",    // the price log's link back to the card
  "Prev Comp",      // the price log's before value
]);

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const sources = ROOTS.flatMap((r) => walk(r)).map((f) => ({ file: f, text: readFileSync(f, "utf8") }));

/** Which files use each name AS A FIELD: read off a record, or written as a
 *  key in a create/update payload. Not every quoted string that happens to
 *  match, which is what makes "Set" detectable at all. */
function fieldUsage(): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  const add = (name: string, file: string) => {
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name)!.add(file);
  };
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/\.?fields\[\s*"([^"]+)"\s*\]/g)) add(m[1], file);
    for (const m of text.matchAll(/^\s*"([A-Z][A-Za-z0-9 ]{2,})":\s/gm)) add(m[1], file);
  }
  return seen;
}

/** Every name asked for in a `fields[]` projection, and where from. */
function projections(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const { file, text } of sources) {
    for (const block of text.matchAll(/"fields\[\]":\s*\[([^\]]*)\]/g)) {
      for (const m of block[1].matchAll(/"([^"]+)"/g)) out.push({ file, name: m[1] });
    }
  }
  return out;
}

/** The rule itself, so the self-tests below can exercise it directly. */
function unknownProjected(
  projected: { file: string; name: string }[],
  usage: Map<string, Set<string>>,
  allowed: Set<string>,
): string[] {
  const out = projected
    .filter((p) => {
      if (allowed.has(p.name)) return false;
      const files = usage.get(p.name);
      if (!files) return true;
      // Known only to the file projecting it is the signature of a typo.
      return files.size === 1 && files.has(p.file);
    })
    .map((p) => `${p.file}  asks for "${p.name}"`);
  return [...new Set(out)];
}

describe("Airtable projections ask for fields that exist", () => {
  it("no projection names a field the rest of the codebase has never used", () => {
    const projected = projections();
    assert.ok(projected.length > 15, "expected to find the projections; the pattern may have changed");

    const orphans = unknownProjected(projected, fieldUsage(), SINGLE_FILE_FIELDS);
    assert.deepEqual(
      orphans,
      [],
      "These names appear in a fields[] projection and are not used as a field in any other " +
        "file, which is what a typo looks like. Airtable rejects the whole request for one bad " +
        "name, so the read returns nothing rather than one empty column. If the name is real " +
        "and genuinely used in one place only, add it to SINGLE_FILE_FIELDS after checking the " +
        "base:\n  " + orphans.join("\n  "),
    );
  });
});

describe("the check itself works", () => {
  it("catches the typo that shipped, in the shape it shipped in", () => {
    // Self-consistent within its own file, which is what defeated the first
    // two versions of this check.
    const usage = new Map([
      ["Set", new Set(["app/api/search/route.ts"])],
      ["Set Name", new Set(["app/api/singles/route.ts", "lib/comp.ts"])],
    ]);
    const hits = unknownProjected(
      [{ file: "app/api/search/route.ts", name: "Set" }],
      usage,
      new Set(),
    );
    assert.equal(hits.length, 1);
    assert.match(hits[0], /asks for "Set"/);
  });

  it("does not flag a field used as a field in another file", () => {
    const usage = new Map([["Set Name", new Set(["app/api/search/route.ts", "lib/comp.ts"])]]);
    assert.deepEqual(
      unknownProjected([{ file: "app/api/search/route.ts", name: "Set Name" }], usage, new Set()),
      [],
    );
  });

  it("does not flag a reviewed single-file field", () => {
    const usage = new Map([["Prev Comp", new Set(["lib/priceLog.ts"])]]);
    assert.deepEqual(
      unknownProjected([{ file: "lib/priceLog.ts", name: "Prev Comp" }], usage, SINGLE_FILE_FIELDS),
      [],
    );
  });

  it("reads real projections out of the real tree", () => {
    const names = projections().map((p) => p.name);
    assert.ok(names.includes("Set Name"), "the palette projection should be found");
    assert.ok(names.includes("Qty On Hand"), "the inventory projections should be found");
  });
});
