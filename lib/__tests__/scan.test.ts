import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  chunk, cleanNumber, cleanText, needsPrinting, parseIdentity,
  quoteTotal, readDataUrl, toQuoteRows, QUOTE_BATCH, type ScanRow,
} from "../scan";

// sc-v1. Quoting a pile and taking it into stock are the same act of reading
// a pile, so they are one scan with two endings. These cover the parts that
// decide what a card IS - the camera and the model call are not testable and
// are deliberately kept out of here.

const row = (over: Partial<ScanRow> = {}): ScanRow => ({
  key: "r1", name: "Metapod", setName: "HeartGold SoulSilver", number: "46/123",
  variant: "Reverse Holofoil", condition: "NM", qty: 1, source: "scan", ...over,
});

describe("reading an identity out of whatever the model said", () => {
  it("takes a bare object", () => {
    assert.deepEqual(
      parseIdentity('{"name":"Metapod","setName":"HeartGold SoulSilver","number":"46/123"}'),
      { name: "Metapod", setName: "HeartGold SoulSilver", number: "46/123" },
    );
  });

  it("digs it out of prose and code fences", () => {
    const wrapped = 'Here is the card:\n```json\n{"name":"Leafeon LV.X","setName":"Majestic Dawn","number":"99/100"}\n```\nHope that helps.';
    assert.equal(parseIdentity(wrapped)?.name, "Leafeon LV.X");
  });

  it("survives a nested object without stopping at the first brace", () => {
    const nested = '{"name":"Eevee","meta":{"conf":0.9},"setName":"Evolutions","number":"63/108"}';
    assert.equal(parseIdentity(nested)?.number, "63/108");
  });

  it("accepts the other field names a model reaches for", () => {
    const alt = '{"cardName":"Metapod","set":"HS","collectorNumber":"46/123"}';
    assert.deepEqual(parseIdentity(alt), { name: "Metapod", setName: "HS", number: "46/123" });
  });

  it("keeps a blank set or number rather than inventing one", () => {
    const thin = '{"name":"Metapod","setName":"","number":""}';
    assert.deepEqual(parseIdentity(thin), { name: "Metapod", setName: "", number: "" });
  });

  it("gives up rather than returning a nameless card", () => {
    // the resolver refuses an empty name anyway, so this would only produce a
    // row that looks identified and is not
    assert.equal(parseIdentity('{"setName":"HS","number":"46/123"}'), null);
    assert.equal(parseIdentity("I cannot read this card"), null);
    assert.equal(parseIdentity("{not json}"), null);
    assert.equal(parseIdentity(""), null);
    assert.equal(parseIdentity(null), null);
  });
});

describe("tidying what comes back", () => {
  it("keeps a collector number as printed", () => {
    assert.equal(cleanNumber("46/123"), "46/123");
    assert.equal(cleanNumber(" SVP 170 "), "SVP 170");
    assert.equal(cleanNumber("007/165"), "007/165", "leading zeros are part of it");
  });

  it("strips decoration without eating the number", () => {
    assert.equal(cleanNumber("#46/123"), "46/123");
    assert.equal(cleanNumber("46/123 ★"), "46/123");
  });

  it("collapses whitespace in text", () => {
    assert.equal(cleanText("  Leafeon   LV.X \n"), "Leafeon LV.X");
    assert.equal(cleanText(null), "");
  });
});

describe("asking which printing it is", () => {
  it("asks on every scanned row that has not answered", () => {
    assert.equal(needsPrinting({ variant: "", source: "scan" }), true);
    assert.equal(needsPrinting({ variant: "   ", source: "scan" }), true);
  });

  it("stops asking once somebody has said", () => {
    assert.equal(needsPrinting({ variant: "Normal", source: "scan" }), false);
    assert.equal(needsPrinting({ variant: "Reverse Holofoil", source: "scan" }), false);
  });

  it("does not ask somebody who typed the card in", () => {
    assert.equal(needsPrinting({ variant: "", source: "hand" }), false);
  });
});

describe("what gets sent for pricing", () => {
  it("sends a complete row in the shape the quote endpoint takes", () => {
    const { ready, held } = toQuoteRows([row()]);
    assert.equal(held.length, 0);
    assert.deepEqual(ready, [{
      name: "Metapod", setName: "HeartGold SoulSilver", number: "46/123",
      variant: "Reverse Holofoil", condition: "NM", qty: 1,
    }]);
  });

  it("holds back a row that has not said which printing", () => {
    // the resolver reads a blank variant as "any printing" and will answer
    // with the wrong one, which is the whole bug this feature exists after
    const { ready, held } = toQuoteRows([row({ variant: "" })]);
    assert.equal(ready.length, 0);
    assert.equal(held.length, 1);
  });

  it("holds back a row nobody could name", () => {
    assert.equal(toQuoteRows([row({ name: "" })]).held.length, 1);
  });

  it("lets a hand-typed row through without a printing", () => {
    assert.equal(toQuoteRows([row({ variant: "", source: "hand" })]).ready.length, 1);
  });

  it("falls back to NM on a condition it does not recognise", () => {
    assert.equal(toQuoteRows([row({ condition: "PSA 10" })]).ready[0].condition, "NM");
  });

  it("never sends a quantity below one", () => {
    for (const q of [0, -3, NaN]) {
      assert.equal(toQuoteRows([row({ qty: q as number })]).ready[0].qty, 1, String(q));
    }
  });
});

describe("splitting a pile into requests", () => {
  it("respects the endpoint's batch of 40", () => {
    assert.equal(QUOTE_BATCH, 40);
    const sizes = chunk(Array.from({ length: 95 }, (_, i) => i)).map((c) => c.length);
    assert.deepEqual(sizes, [40, 40, 15]);
  });

  it("does not make a request out of nothing", () => {
    assert.deepEqual(chunk([]), []);
  });

  it("keeps every card, in order", () => {
    const all = Array.from({ length: 83 }, (_, i) => i);
    assert.deepEqual(chunk(all).flat(), all);
  });
});

describe("adding up the quote", () => {
  it("extends by quantity", () => {
    const t = quoteTotal([{ matched: true, price: 12.5, qty: 4 }]);
    assert.equal(t.total, 50);
    assert.equal(t.priced, 4);
  });

  it("counts what could not be priced instead of calling it zero", () => {
    // a total that quietly swallows the unpriced cards is how you underpay
    // for a collection
    const t = quoteTotal([
      { matched: true, price: 10, qty: 1 },
      { matched: false, price: null, qty: 2 },
    ]);
    assert.equal(t.total, 10);
    assert.equal(t.unmatched, 2);
  });

  it("treats a matched card with no number as unpriced", () => {
    const t = quoteTotal([{ matched: true, price: 0, qty: 1 }]);
    assert.equal(t.priced, 0);
    assert.equal(t.unmatched, 1);
  });

  it("is zero on an empty pile", () => {
    assert.deepEqual(quoteTotal([]), { total: 0, priced: 0, unmatched: 0 });
  });
});

describe("accepting an uploaded photo", () => {
  it("takes the image types the model will read", () => {
    for (const t of ["jpeg", "png", "webp"]) {
      assert.deepEqual(readDataUrl(`data:image/${t};base64,AAAA`), { media: `image/${t}`, data: "AAAA" });
    }
  });

  it("refuses anything that is not one of those", () => {
    // a gif or an svg reaching the model is a failed upstream call and a
    // confusing error; better to say no here
    assert.equal(readDataUrl("data:image/gif;base64,AAAA"), null);
    assert.equal(readDataUrl("data:image/svg+xml;base64,AAAA"), null);
    assert.equal(readDataUrl("data:text/html;base64,AAAA"), null);
  });

  it("refuses something that is not a data url at all", () => {
    assert.equal(readDataUrl("https://example.com/card.jpg"), null);
    assert.equal(readDataUrl(""), null);
    assert.equal(readDataUrl(undefined), null);
  });
});
