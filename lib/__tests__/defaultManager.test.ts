import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { pickDefaultManager, type StreamerLike } from "../defaultManager";

// dm-v1. A show created without an explicit manager had no manager of record
// at all, so its packing hours had nowhere to land and nothing held it in the
// admin lists. The fallback is a Default Manager tick on the Streamers table,
// which means it can be moved without a deploy.

const p = (id: string, fields: Record<string, any> = {}): StreamerLike => ({ id, fields });

const GABE = p("recGabe", { Name: "Gabe", Role: "admin", "Default Manager": true });
const DANIEL = p("recDaniel", { Name: "Daniel", Role: "manager" });
const ALYSSA = p("recAlyssa", { Name: "Alyssa", Role: "streamer" });

describe("who manages a show nobody assigned", () => {
  it("picks the ticked person", () => {
    assert.equal(pickDefaultManager([ALYSSA, GABE, DANIEL]), "recGabe");
  });

  it("does not care where they sit in the table", () => {
    assert.equal(pickDefaultManager([GABE, ALYSSA]), "recGabe");
    assert.equal(pickDefaultManager([ALYSSA, GABE]), "recGabe");
  });

  it("returns nothing when nobody is ticked, rather than guessing", () => {
    // picking an admin on its own would silently start assigning shows to
    // whoever happened to be made an admin next
    assert.equal(pickDefaultManager([ALYSSA, DANIEL]), null);
    assert.equal(pickDefaultManager([]), null);
  });

  it("skips somebody who has been deactivated", () => {
    // the flag outliving the person would keep handing them shows, which is
    // the opposite of what switching them off meant
    const gone = p("recGone", { Name: "Daniel", "Default Manager": true, "Deactivated At": "2026-10-06T18:00:00.000Z" });
    assert.equal(pickDefaultManager([gone]), null);
    assert.equal(pickDefaultManager([gone, GABE]), "recGabe", "falls through to the live one");
  });

  it("settles on one person when two are ticked by mistake", () => {
    const also = p("recTwo", { Name: "Daniel", "Default Manager": true });
    assert.equal(pickDefaultManager([GABE, also]), "recGabe");
    assert.equal(pickDefaultManager([GABE, also]), "recGabe", "and gives the same answer every time");
  });

  it("treats an unticked box the same as no box at all", () => {
    assert.equal(pickDefaultManager([p("recX", { "Default Manager": false })]), null);
    assert.equal(pickDefaultManager([p("recX", {})]), null);
  });
});
