import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { basisOf } from "../pricingHealth";
import { fallbackCompSource } from "../comp";

const rec = (fields: Record<string, any>) => ({ id: "rec1", fields } as any);

// basisOf reads Comp Source strings that lib/comp.ts writes. That is a
// contract across two files with nothing but a regex holding it together,
// which is precisely how the "est." flag broke: the writer changed and the
// reader never noticed. So the strings under test are produced by the real
// writer wherever possible, not retyped by hand.
describe("basisOf", () => {
  it("recognises a comp built from real sales", () => {
    assert.equal(basisOf(rec({ Comp: 250, "Comp Source": "TCGplayer solds (LP, median of 4)" })), "solds");
  });

  it("recognises a comp built from the condition listing floor", () => {
    // exact string from the listing branch of recompSingle
    assert.equal(
      basisOf(rec({ Comp: 250, "Comp Source": "TCGplayer lowest LP listing (Holofoil, 3 live)" })),
      "listing"
    );
  });

  it("recognises every estimate the fallback can actually produce", () => {
    for (const [mult, cond] of [[1, "NM"], [0.9, "LP"], [0.8, "MP"], [0.65, "HP"], [0.5, "DM"]] as [number, string][]) {
      const src = fallbackCompSource("Reverse Holofoil", mult, cond);
      assert.equal(basisOf(rec({ Comp: 10, "Comp Source": src })), "estimate", src);
    }
  });

  it("does not count an estimate as condition-specific", () => {
    const src = fallbackCompSource("Holofoil", 0.9, "LP");
    const b = basisOf(rec({ Comp: 405.65, "Comp Source": src }));
    assert.notEqual(b, "solds");
    assert.notEqual(b, "listing");
  });

  it("treats a hand-typed comp as manual, not as a pipeline success", () => {
    assert.equal(basisOf(rec({ Comp: 200, "Comp Source": "" })), "manual");
    assert.equal(basisOf(rec({ Comp: 200, "Comp Source": "eBay sold, checked by hand" })), "manual");
  });

  it("separates no comp from a zero comp", () => {
    assert.equal(basisOf(rec({})), "none");
    assert.equal(basisOf(rec({ Comp: null })), "none");
    // a card genuinely worth nothing has still been priced
    assert.equal(basisOf(rec({ Comp: 0, "Comp Source": "TCGplayer solds (NM, median of 3)" })), "solds");
  });

  it("still classifies the legacy import strings already in the table", () => {
    // what the 8/20 TCGplayer export wrote, and what every unrefreshed card
    // still carries - these must not be mistaken for pipeline output
    assert.equal(basisOf(rec({ Comp: 52, "Comp Source": "TCGplayer export (market, NM)" })), "manual");
    assert.equal(basisOf(rec({ Comp: 24.52, "Comp Source": "TCGplayer market (holofoil)" })), "manual");
  });
});
