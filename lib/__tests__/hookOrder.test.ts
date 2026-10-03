import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A hook after an early return takes the whole page down.
//
// This is here because it happened, in production, during a show. Two useMemo
// calls were added to StreamEditor below `if (!data) return <Loading/>`. The
// first render has no data, so it bailed out and ran neither. The fetch landed,
// the second render ran both, React counted a different number of hooks than
// last time and threw error #310, and the stream page showed an error screen
// every single time it was opened.
//
// It is invisible in review: the code reads fine, it is a hundred and twenty
// lines away from the return that breaks it, and the component is 1300 lines
// long. It is invisible in the unit tests too, because the logic inside the
// hooks was correct. Only mounting the component catches it, and there is no
// component test harness here. So it gets caught by reading the source.
//
// The rule React actually enforces: in one component, the hook calls must run
// in the same order every render. Any hook that can be skipped by an earlier
// return breaks that.

const ROOTS = ["app", "components"];
const SKIP = new Set(["node_modules", ".next", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

// The hook name is followed by `(`, or by `<` when the call carries an explicit
// type argument.
//
// That second case is not a detail. The first version of this file required a
// `(` immediately after the name, so it silently skipped every
// `useState<LineT[]>([])` and `useRef<Record<string, X>>({})` in the codebase,
// which in a TypeScript app is most of them. It then passed, cleanly, on a
// `useRef` sitting below an early return in this very component: the same bug
// it was written to catch, in a shape it could not see.
//
// A guard that reports green on the bug it exists for is worse than nothing,
// because it is also the reason nobody looks.
const HOOK = /^\s{2}(?:const|let|var)?\s*[\w{[\], :]*=?\s*(use[A-Z]\w*)\s*[<(]/;
const BARE_HOOK = /^\s{2}(use[A-Z]\w*)\s*[<(]/;
// A return at the component's own indent level. Returns nested inside a
// callback, a map or an if-block are indented further and cannot skip a hook
// in the component body.
const TOP_RETURN = /^\s{2}(?:return\b|if\s*\(.*\)\s*return\b)/;
// `function Foo(` or `export default function Foo(` at column zero starts a new
// component, which resets the question: a return in one cannot skip a hook in
// the next.
const FN_START = /^(?:export\s+default\s+)?(?:async\s+)?function\s+\w+/;

type Finding = { file: string; hook: string; hookLine: number; returnLine: number };

function findHooksAfterReturn(file: string): Finding[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const found: Finding[] = [];
  let firstReturn = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FN_START.test(line)) { firstReturn = -1; continue; }
    if (firstReturn === -1 && TOP_RETURN.test(line)) { firstReturn = i + 1; continue; }
    if (firstReturn === -1) continue;
    const m = HOOK.exec(line) || BARE_HOOK.exec(line);
    // useRef and useState are just as unsafe as the rest; no exceptions, since
    // the rule is about call order and not about what the hook does.
    if (m) found.push({ file, hook: m[1], hookLine: i + 1, returnLine: firstReturn });
  }
  return found;
}

describe("React hook order", () => {
  it("no component calls a hook after a return that could skip it", () => {
    const findings = walk(ROOTS[0]).concat(walk(ROOTS[1])).flatMap(findHooksAfterReturn);
    assert.deepEqual(
      findings,
      [],
      "A hook below an early return runs on some renders and not others, which is " +
        "React error #310 and a blank page, not a warning:\n" +
        findings
          .map(
            (f) =>
              `  ${f.file}:${f.hookLine} calls ${f.hook}() after the return on line ${f.returnLine}\n` +
              `    move it above that return`,
          )
          .join("\n"),
    );
  });
});

describe("the check itself works", () => {
  // A guard with a bug in it is worse than no guard, because it reports a clean
  // build forever. These two cases are the exact shapes that matter.
  it("would have caught the StreamEditor regression", () => {
    const bad = `export default function C() {
  const [data, setData] = useState(null);
  if (!data) return <p>Loading</p>;
  const x = useMemo(() => 1, []);
  return <p>{x}</p>;
}
`;
    const f = "/tmp/__hookorder_bad.tsx";
    writeFileSync(f, bad);
    const hits = findHooksAfterReturn(f);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hook, "useMemo");
  });

  it("catches a hook that carries an explicit type argument", () => {
    // The shape that got through. `useRef<T>(...)` and `useState<T>(...)` are
    // how most hooks are written in this codebase, and the original pattern
    // required a bare `(` after the name, so none of them were ever examined.
    const bad = `export default function C() {
  const [data, setData] = useState<any>(null);
  if (!data) return <p>Loading</p>;
  const chain = useRef<Record<string, Promise<unknown>>>({});
  return <p>{String(chain)}</p>;
}
`;
    const f = "/tmp/__hookorder_generic.tsx";
    writeFileSync(f, bad);
    const hits = findHooksAfterReturn(f);
    assert.equal(hits.length, 1, "a generic hook call below an early return must be caught");
    assert.equal(hits[0].hook, "useRef");
  });

  it("does not mistake a less-than comparison for a type argument", () => {
    // The cost of accepting `<` after the name. An argument that opens with a
    // comparison must not read as a generic, or the guard starts crying wolf.
    const ok = `export default function C() {
  if (!ready) return null;
  const n = compute(a < b ? 1 : 2);
  return <p>{n}</p>;
}
`;
    const f = "/tmp/__hookorder_lt.tsx";
    writeFileSync(f, ok);
    assert.deepEqual(findHooksAfterReturn(f), []);
  });

  it("does not flag a return nested inside a callback", () => {
    // `lines.map(l => { return ... })` is not an early return, and a guard that
    // thought it was would flag most of this codebase and get switched off.
    const ok = `export default function C() {
  const rows = items.map((i) => {
    return <li key={i} />;
  });
  const x = useMemo(() => 1, []);
  return <ul>{rows}</ul>;
}
`;
    const f = "/tmp/__hookorder_ok.tsx";
    writeFileSync(f, ok);
    assert.deepEqual(findHooksAfterReturn(f), []);
  });
});
