import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { salesForPrinting, saleVariant } from "../tcgcsvCards";
import { condLabel, outlierCompSource, soldsCompSource, SOLDS_MARKER } from "../comp";

// rp-v1. A Reverse Holofoil and a Normal share one TCGplayer productId, and
// the sold-sales lookup asked for both: the request body sent variants: []
// and nothing filtered the rows afterwards. The live floor WAS printing-aware,
// so a card could carry a Market of "Reverse Holofoil NM, low of 1 listing"
// beside a Comp built entirely from Normal sales, with nothing on the record
// admitting it.
//
// HS Metapod, slot 389: four Normal sales near $2.76 and one real Reverse sale
// at $20. The median came out at the Normal price and the one Reverse sale was
// then discarded as an outlier. Comp $3 on a card listing at $19.

const sale = (price: number, variant?: string, extra: Record<string, any> = {}) => ({
  purchasePrice: price,
  orderDate: new Date().toISOString(),
  quantity: 1,
  ...(variant === undefined ? {} : { variant }),
  ...extra,
});

describe("reading the printing off a sold row", () => {
  it("finds it whatever TCGplayer called the field this month", () => {
    assert.equal(saleVariant({ variant: "Reverse Holofoil" }), "Reverse Holofoil");
    assert.equal(saleVariant({ variantName: "Reverse Holofoil" }), "Reverse Holofoil");
    assert.equal(saleVariant({ subTypeName: "Normal" }), "Normal");
    assert.equal(saleVariant({ printing: "Holofoil" }), "Holofoil");
  });

  it("says nothing rather than guessing when the row has no printing", () => {
    assert.equal(saleVariant({ purchasePrice: 3 }), "");
    assert.equal(saleVariant({ variant: "   " }), "");
    assert.equal(saleVariant(null), "");
  });
});

describe("keeping only the printing we hold", () => {
  const rows = [
    sale(2.5, "Normal"), sale(2.76, "Normal"), sale(3.0, "Normal"), sale(2.8, "Normal"),
    sale(20, "Reverse Holofoil"),
  ];

  it("leaves the Metapod with its one real sale instead of four of the wrong card", () => {
    const kept = salesForPrinting(rows, "Reverse Holofoil");
    assert.deepEqual(kept.map((r) => r.purchasePrice), [20]);
  });

  it("gives the Normal card its own sales back", () => {
    assert.deepEqual(salesForPrinting(rows, "Normal").map((r) => r.purchasePrice), [2.5, 2.76, 3.0, 2.8]);
  });

  it("does not care about spacing or capitals in the name", () => {
    const odd = [sale(20, "reverse holofoil"), sale(3, "NORMAL")];
    assert.deepEqual(salesForPrinting(odd, "Reverse Holofoil").map((r) => r.purchasePrice), [20]);
  });

  it("returns nothing when this printing simply has not sold", () => {
    // deliberate: the caller turns an empty list into null, which sends the
    // comp to the live floor - and the floor already knows the printing
    assert.deepEqual(salesForPrinting([sale(2.5, "Normal")], "Reverse Holofoil"), []);
  });

  it("passes everything through when no printing was asked for", () => {
    assert.equal(salesForPrinting(rows, "").length, 5);
  });

  it("passes everything through when TCGplayer stops sending printings at all", () => {
    // the shape changing must not silently price every card at nothing. Wrong
    // the old way beats no comp, and the health canary is what catches this.
    const bare = [sale(2.5), sale(20)];
    assert.equal(salesForPrinting(bare, "Reverse Holofoil").length, 2);
  });

  it("drops a row with no printing when its neighbours have one", () => {
    // a partial response is the dangerous case: a blank row could be either
    // card, and guessing is how the wrong one gets in
    const mixed = [sale(20, "Reverse Holofoil"), sale(2.5)];
    assert.deepEqual(salesForPrinting(mixed, "Reverse Holofoil").map((r) => r.purchasePrice), [20]);
  });

  it("copes with an empty response", () => {
    assert.deepEqual(salesForPrinting([], "Reverse Holofoil"), []);
  });
});

describe("saying on the record which printing a comp came from", () => {
  it("puts the printing in front of the condition", () => {
    assert.equal(condLabel("NM", "Reverse Holofoil"), "Reverse Holofoil NM");
  });

  it("leaves the label alone when there is no printing", () => {
    assert.equal(condLabel("NM"), "NM");
    assert.equal(condLabel("NM", "   "), "NM");
  });

  it("names the printing in the outlier note, which is the one that misled us", () => {
    const s = outlierCompSource("NM", 20, 2.76, 4, "Reverse Holofoil");
    assert.match(s, /Reverse Holofoil NM/);
    assert.match(s, /set aside as an outlier/);
  });

  it("keeps every existing caller reading exactly as it did", () => {
    assert.equal(soldsCompSource("NM", 4), `TCGplayer ${SOLDS_MARKER} (NM, median of 4 in last 30d)`);
    assert.equal(outlierCompSource("NM", 20, 2.76, 4), outlierCompSource("NM", 20, 2.76, 4, ""));
  });
});
