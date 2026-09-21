import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cleanLineName, streamReport, productHistory, lineMatches, shelfGap, type AuditLine, type AuditStream } from "../audit";

const L = (o: Partial<AuditLine> & { id: string }): AuditLine => ({
  streamId: "s1", productId: "", singleId: "", name: "1x Thing", qty: 1, hit: 0, market: 1, buy: 0,
  giveaway: false, store: false, soldPrice: 0, created: "", ...o,
});

describe("cleanLineName", () => {
  it("drops the quantity prefix and the store tag", () => {
    assert.equal(cleanLineName("4x Chaos Rising Booster Pack"), "Chaos Rising Booster Pack");
    assert.equal(cleanLineName("1x Surging Sparks ETB (store)"), "Surging Sparks ETB");
    assert.equal(cleanLineName("Gengar ex"), "Gengar ex");
  });
});

describe("streamReport", () => {
  const lines = [
    L({ id: "a", name: "10x Darkness Ablaze Booster Pack", qty: 10, hit: 7, market: 6, buy: 4, productId: "p1" }),
    L({ id: "b", name: "1x Gengar ex", qty: 1, hit: 1, market: 125, singleId: "c1" }),
    L({ id: "c", name: "2x Charizard UPC", qty: 2, hit: 0, market: 120 }),
    L({ id: "d", name: "1x Surging Sparks ETB (store)", qty: 1, hit: 1, market: 50, store: true, soldPrice: 55 }),
  ];
  const r = streamReport(lines, { c1: { no: 570, set: "30th Celebration" } });
  it("lists only what was pulled, biggest first", () => {
    assert.deepEqual(r.hits.map((h) => h.name), ["Gengar ex", "Surging Sparks ETB", "Darkness Ablaze Booster Pack"]);
    assert.equal(r.hits[0].sticker, 570);
  });
  it("keeps what came back separate, store sales excluded", () => {
    assert.deepEqual(r.notHit.map((h) => [h.name, h.back]), [["Charizard UPC", 2], ["Darkness Ablaze Booster Pack", 3]]);
  });
  it("totals hits by kind and store sales at what they sold for", () => {
    assert.equal(r.totals.itemsHit, 9);
    assert.equal(r.totals.sealedHit, 7);
    assert.equal(r.totals.singlesHit, 1);
    assert.equal(r.totals.storeSales, 55);
    assert.equal(r.totals.hitValue, 7 * 6 + 125 + 55);
    assert.equal(r.totals.hitCost, 28);
    assert.equal(r.totals.onSet, 13);
  });
  it("never counts more hits than went on the set", () => {
    const x = streamReport([L({ id: "z", qty: 2, hit: 5, market: 1 })]);
    assert.equal(x.totals.itemsHit, 2);
  });
});

describe("product history", () => {
  const streams: Record<string, AuditStream> = {
    s1: { id: "s1", date: "2026-09-10", title: "Fri", streamer: "D", type: "Surprise Set", status: "Complete", returned: true },
    s2: { id: "s2", date: "2026-09-17", title: "Fri", streamer: "D", type: "Surprise Set", status: "Complete", returned: true },
  };
  const lines = [
    L({ id: "a", streamId: "s1", productId: "p1", name: "10x Darkness Ablaze Booster Pack", qty: 10, hit: 8, market: 6 }),
    L({ id: "b", streamId: "s2", productId: "p1", name: "5x Darkness Ablaze Pack", qty: 5, hit: 5, market: 6 }),
    L({ id: "c", streamId: "s2", productId: "p9", name: "1x Darkness Ablaze ETB", qty: 1, hit: 1, market: 60 }),
    L({ id: "d", streamId: "gone", productId: "p1", name: "1x Darkness Ablaze Booster Pack", qty: 1, hit: 1 }),
  ];
  it("finds a picked product by record even after a rename, newest show first", () => {
    const h = productHistory(lines, streams, "p1", "");
    assert.deepEqual(h.rows.map((r) => r.streamId), ["s2", "s1"]);
    assert.equal(h.totals.hit, 13);
    assert.equal(h.totals.back, 2);
  });
  it("free text catches every product with those words", () => {
    const h = productHistory(lines, streams, "", "darkness ablaze");
    assert.equal(h.rows.find((r) => r.streamId === "s2")!.hit, 6);
  });
  it("matches every word in any order", () => {
    assert.equal(lineMatches(lines[0], "", "ablaze darkness"), true);
    assert.equal(lineMatches(lines[0], "", "ablaze evolving"), false);
    assert.equal(lineMatches(lines[0], "", ""), false);
  });
});

describe("shelfGap", () => {
  it("is what the app thinks minus what is counted", () => {
    assert.equal(shelfGap(20, 14), 6);
    assert.equal(shelfGap(20, 22), -2);
    assert.equal(shelfGap(-5, 0), 0);
    assert.equal(shelfGap(20, null), null);
  });
});
