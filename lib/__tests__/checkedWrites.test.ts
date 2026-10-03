import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes have to be checked.
//
// Nine separate bugs in this app were one sentence: a toast, a chip or a
// confirmation built from what was *requested* instead of what was *observed*.
// They are invisible in review because the happy path is identical, and they
// are invisible in testing because the write usually succeeds. They surface in
// front of the person least able to do anything about it:
//
//   "20 products deleted"      over a table with all twenty rows still in it
//   "Saved"                    next to a commission rate that did not save
//   "Held for you: 4 cards"    including one reserved for somebody else
//   "47 cards numbered B1-1 to B1-50"   a range with holes in it
//   "40 prices updated"        after the run died with 160 untouched
//
// The shape is mechanical, so this catches it mechanically: a write whose
// Response is thrown away. It is deliberately narrow, matching only a bare
// `await fetch(...)` statement whose result is never bound or tested, because
// a check that fires on correct code is a check that gets deleted.

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);
const WRITE = /method:\s*["'](POST|PATCH|PUT|DELETE)["']/;

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

// A statement that starts a write and discards what comes back.
//
//   await fetch(`/api/x/${id}`, { method: "DELETE" });     <- discarded
//   const r = await fetch(...)                             <- bound, fine
//   if (!(await fetch(...)).ok)                            <- tested, fine
//   return fetch(...)                                      <- handed on, fine
//   void fetch(...).catch(...)                             <- deliberate, fine
const DISCARDED = /^\s*await\s+fetch\s*\(/;

type Hit = { file: string; line: number; text: string };

/** The whole statement starting at `i`, by tracking bracket depth rather than
 *  hunting for a closing token. An earlier version looked for the first ");"
 *  and got it wrong on a one-line call ending `.catch(() => {});`, so it
 *  reported two writes that handle their failure deliberately and in writing.
 *  A check that cries wolf is a check somebody switches off. */
function statementAt(lines: string[], i: number): string {
  let depth = 0;
  const parts: string[] = [];
  for (let j = i; j < Math.min(i + 20, lines.length); j++) {
    parts.push(lines[j]);
    for (const ch of lines[j]) {
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
    }
    if (depth <= 0 && /;\s*$/.test(lines[j])) break;
  }
  return parts.join("\n");
}

function discardedWrites(file: string): Hit[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const out: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!DISCARDED.test(lines[i])) continue;
    const stmt = statementAt(lines, i);
    if (!WRITE.test(stmt)) continue;
    // An explicit .catch() or .then() anywhere in the statement means the
    // author decided what a failure means. That is the whole ask.
    if (/\.(catch|then)\s*\(/.test(stmt)) continue;
    out.push({ file, line: i + 1, text: lines[i].trim().slice(0, 90) });
  }
  return out;
}

describe("a write's response is never thrown away", () => {
  it("no component fires a write and ignores the result", () => {
    const found = ROOTS.flatMap((r) => walk(r)).flatMap(discardedWrites);
    assert.deepEqual(
      found,
      [],
      "Each of these sends a POST/PATCH/PUT/DELETE and never looks at the response, so " +
        "whatever it tells the user afterwards is a guess. Bind it and check `.ok`, or " +
        "add an explicit .catch() if the failure genuinely does not matter:\n  " +
        found.map((f) => `${f.file}:${f.line}  ${f.text}`).join("\n  "),
    );
  });
});

describe("the check itself works", () => {
  it("flags a discarded write", () => {
    const f = "/tmp/__checked_bad.tsx";
    writeFileSync(
      f,
      ["async function go() {", '  await fetch(`/api/x/${id}`, { method: "DELETE" });', '  toast("deleted");', "}", ""].join("\n"),
    );
    assert.equal(discardedWrites(f).length, 1);
  });

  it("does not flag a bound or deliberately handled write", () => {
    const f = "/tmp/__checked_ok.tsx";
    writeFileSync(
      f,
      [
        "async function go() {",
        '  const r = await fetch(`/api/x/${id}`, { method: "DELETE" });',
        "  if (!r.ok) toast(\"failed\");",
        '  await fetch("/api/y", { method: "POST", body: b }).catch(() => {});',
        '  await fetch("/api/z");',
        "}",
        "",
      ].join("\n"),
    );
    assert.deepEqual(discardedWrites(f), []);
  });

  it("sees a write whose options span several lines", () => {
    const f = "/tmp/__checked_multiline.tsx";
    writeFileSync(
      f,
      [
        "async function go() {",
        "  await fetch(`/api/settings`, {",
        '    method: "PATCH",',
        '    headers: { "Content-Type": "application/json" },',
        "    body: JSON.stringify({ key, value }),",
        "  });",
        '  setSaved(key);',
        "}",
        "",
      ].join("\n"),
    );
    assert.equal(discardedWrites(f).length, 1, "the settings bug had its method three lines down");
  });
});
