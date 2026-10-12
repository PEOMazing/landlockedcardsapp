import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { recompSingle } from "../comp";

// cl-v1. The rolling reprice sweeps every In Stock raw card every 15 minutes,
// oldest-checked first, and nothing stopped it overwriting a price somebody
// had set by hand. Leafeon LV.X is the case that forced this: one TCGplayer
// sale at $745 against an eBay market near $1,900. Setting the real number
// without a lock would have lasted about an hour.

const card = (fields: Record<string, any> = {}) => ({
  id: "recCard",
  fields: { Condition: "NM", ...fields },
}) as any;

describe("a comp somebody set by hand", () => {
  it("is left alone by the recomp", async () => {
    const r = await recompSingle(card({ "Comp Locked": true }));
    assert.equal(r.ok, false);
    assert.match(String(r.reason), /locked/);
  });

  it("says how to hand it back, rather than just refusing", async () => {
    const r = await recompSingle(card({ "Comp Locked": true }));
    assert.match(String(r.reason), /untick Comp Locked/);
  });

  it("can still be re-comped when somebody explicitly asks", async () => {
    // force is for a person pressing the button on the card page. It must get
    // past the lock, and then fail for an ordinary reason rather than this one.
    const r = await recompSingle(card({ "Comp Locked": true }), { force: true });
    assert.ok(!String(r.reason || "").includes("locked"));
  });

  it("does not block a card that is not locked", async () => {
    for (const f of [{}, { "Comp Locked": false }]) {
      const r = await recompSingle(card(f));
      assert.ok(!String(r.reason || "").includes("locked"), JSON.stringify(f));
    }
  });

  it("checks the lock before the graded rule, so a locked slab stays locked", async () => {
    const r = await recompSingle(card({ Condition: "PSA 10", "Comp Locked": true }));
    assert.match(String(r.reason), /locked/);
  });
});
