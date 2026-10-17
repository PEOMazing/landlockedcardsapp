import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectStepChange,
  isPricedSale,
  moveFactorOf,
  pricedSales,
  slabComp,
  slabCompSource,
  STEP_FACTOR,
  STEP_MAX_GAP,
  STEP_MIN_OLDER,
  STEP_MIN_RECENT,
} from "../slabComp";
import type { SaleRow } from "../gradedSales";
import { dropLowOutliers, dropWashSales } from "../salesWindow";

// sl-v5. Every number in this file is real.
//
// On 2026-10-16 the comp engine was asked what a PSA 10 Darkrai Prism Star was
// worth and the honest answer was somewhere near $9,000. It said $2,500, which
// was below every October sale and above every September one. Chasing that
// produced three separate defects, and this file pins all three:
//
//   1. a median over a fixed window silently blends two markets
//   2. an accepted Best Offer's ASK was being read as its sale price
//   3. dropWashSales measured its floor against the window high, so one absurd
//      sale evicted every real one
//
// The dates are written relative to a fixed NOW so the tests do not rot.

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86400000).toISOString().slice(0, 10);

function sale(price: number, agoDays: number, extra: Partial<SaleRow> = {}): SaleRow {
  return {
    date: daysAgo(agoDays),
    price,
    title: "",
    url: "",
    format: "FIXED_PRICE",
    bestOffer: false,
    ...extra,
  };
}

// The actual Darkrai Prism Star Ultra Prism 77/156 PSA 10 sold listings, read
// off 130point on 2026-10-16. The two October sales are the new market; the
// September ones are the old one.
const DARKRAI: SaleRow[] = [
  sale(9499.99, 1), // Oct 15, fixed price
  sale(8500, 8, { bestOffer: true, askingPrice: 15000 }), // Oct 08, offer accepted off a $15,000 ask
  sale(2500, 20, { bestOffer: true, askingPrice: 3500 }), // Sep 26
  sale(2000, 22), // Sep 24
  sale(2000, 22), // Sep 24
];

describe("the Darkrai case, which is why this code exists", () => {
  it("prices off the new level and not the blend", () => {
    const r = slabComp(DARKRAI, NOW);
    assert.ok(r);
    // The median of all five is $2,500. That number was never true on any day.
    assert.notEqual(r!.price, 2500);
    assert.equal(r!.price, 9000);
  });

  it("knows it was a step up, and by how much", () => {
    const r = slabComp(DARKRAI, NOW)!;
    assert.ok(r.step, "should have detected a repricing");
    assert.equal(r.step!.direction, "up");
    assert.equal(r.step!.to, 9000);
    assert.equal(r.step!.from, 2000);
    assert.ok(r.step!.gap >= 3, `gap ${r.step!.gap} should be wide`);
  });

  it("prices off exactly the two October sales", () => {
    const r = slabComp(DARKRAI, NOW)!;
    assert.equal(r.used.length, 2);
    assert.deepEqual(
      r.used.map((s) => s.price),
      [9499.99, 8500],
    );
  });

  it("sets the September sales aside as a market, not as outliers", () => {
    const r = slabComp(DARKRAI, NOW)!;
    assert.equal(r.dropped.length, 3);
    const src = slabCompSource({ grader: "PSA", grade: "10" }, r);
    assert.match(src, /repriced up/);
    assert.match(src, /was \$2,000/);
    assert.doesNotMatch(src, /low sale/, "an old market is not a wash sale");
  });

  it("keeps the $8,500 sale even though it was a Best Offer", () => {
    // The sale is negotiated AND readable: 130point published $8,500 against a
    // $15,000 ask. Dropping every negotiated sale would have thrown away the
    // best evidence on the card and left a single October print, which is not
    // enough to establish a level.
    const r = slabComp(DARKRAI, NOW)!;
    assert.ok(r.used.some((s) => s.price === 8500));
    assert.equal(r.askOnly.length, 0);
  });
});

describe("an ask is not a price", () => {
  it("drops a row whose price is exactly its own asking price", () => {
    // What a mis-ingest looks like from the outside: the vendor recorded the
    // $15,000 ask as the sale. A genuine accepted offer does not land on the
    // ask to the cent.
    const bogus = sale(15000, 8, { bestOffer: true, askingPrice: 15000 });
    assert.equal(isPricedSale(bogus), false);
  });

  it("keeps a best offer whose accepted price is below the ask", () => {
    assert.equal(isPricedSale(sale(8500, 8, { bestOffer: true, askingPrice: 15000 })), true);
  });

  it("drops a row the feed marked unreadable", () => {
    assert.equal(isPricedSale(sale(15000, 8, { bestOffer: true, askOnly: true })), false);
  });

  it("leaves ordinary fixed-price and auction sales alone", () => {
    assert.equal(isPricedSale(sale(2000, 3)), true);
    assert.equal(isPricedSale(sale(1025, 3, { format: "AUCTION" })), true);
  });

  it("never lets an ask into the median", () => {
    const rows = [
      sale(2100, 2),
      sale(2000, 4),
      sale(1900, 6),
      sale(15000, 8, { bestOffer: true, askingPrice: 15000 }),
    ];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.price, 2000);
    assert.equal(r.askOnly.length, 1);
    assert.ok(!r.used.some((s) => s.price === 15000));
  });

  it("says out loud that sales were excluded", () => {
    const rows = [
      sale(2100, 2),
      sale(2000, 4),
      sale(1900, 6),
      sale(15000, 8, { bestOffer: true, askingPrice: 15000 }),
    ];
    const src = slabCompSource({ grader: "PSA", grade: "10" }, slabComp(rows, NOW)!);
    assert.match(src, /1 negotiated sale excluded/);
  });

  it("returns null rather than a comp when every sale is unreadable", () => {
    // "We cannot see what these sold for" is a different answer from "nothing
    // sold", and inventing a number from asking prices is how the whole mess
    // started. Null means leave the existing comp alone.
    const rows = [
      sale(15000, 2, { bestOffer: true, askOnly: true }),
      sale(12000, 5, { bestOffer: true, askOnly: true }),
    ];
    assert.equal(slabComp(rows, NOW), null);
  });

  it("sorts priced sales newest first regardless of input order", () => {
    const rows = [sale(100, 10), sale(300, 1), sale(200, 5)];
    assert.deepEqual(
      pricedSales(rows).map((s) => s.price),
      [300, 200, 100],
    );
  });
});

describe("one print is noise, two is a market", () => {
  it("does NOT reprice on a single spike", () => {
    // The thing I nearly got wrong in the other direction. A lone $15,000
    // against five sales between $1,025 and $2,500 must not move the comp,
    // because pairing it with the next sale down spans 6x and 6x is not a
    // level.
    const rows = [
      sale(15000, 1),
      sale(2500, 10),
      sale(2000, 14),
      sale(2000, 15),
      sale(1100, 20),
    ];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.step, undefined, "a single spike is not a repricing");
    assert.equal(r.price, 2000);
  });

  it("does not reprice on a single crash either", () => {
    const rows = [sale(200, 1), sale(2000, 10), sale(2100, 14), sale(1900, 18)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.step, undefined);
  });

  it("needs at least STEP_MIN_RECENT sales at the new level", () => {
    assert.equal(STEP_MIN_RECENT, 2);
    const one = [sale(9000, 1), sale(2000, 10), sale(2100, 14)];
    assert.equal(detectStepChange(one), null);
    const two = [sale(9000, 1), sale(8800, 3), sale(2000, 10), sale(2100, 14)];
    assert.ok(detectStepChange(two));
  });

  it("needs a real gap, not ordinary spread", () => {
    assert.equal(STEP_FACTOR, 2);
    // A healthy market in one card: everything within tens of percent.
    const normal = [sale(2200, 1), sale(2150, 4), sale(2000, 9), sale(1900, 14), sale(2050, 20)];
    assert.equal(detectStepChange(normal), null);
    const r = slabComp(normal, NOW)!;
    assert.equal(r.step, undefined);
    assert.equal(r.price, 2050);
  });

  it("requires the new level to be internally tight", () => {
    // Two recent sales that disagree with each other by more than STEP_FACTOR
    // are not a level, they are two unrelated events.
    const scattered = [sale(20000, 1), sale(8000, 3), sale(2000, 10), sale(2100, 14)];
    assert.equal(detectStepChange(scattered), null);
  });
});

describe("one high sale at the top of the old cluster cannot hide a move", () => {
  // Dark Weezing 1st Edition Team Rocket 14/82 PSA 10, from the sweep.
  // September ran $1,055 to $1,550, October ran $3,050 to $3,999. An
  // edge-to-edge magnitude test scored that 3050/1550 = 1.97 and rejected the
  // step for being 0.03 under the bar, on the strength of one high September
  // sale. Median to median it is 3.5x and obvious.
  const DARK_WEEZING: SaleRow[] = [
    sale(3050, 4, { format: "AUCTION" }),
    sale(3999.95, 8),
    sale(3950, 12, { format: "AUCTION" }),
    sale(1055.15, 23),
    sale(1550, 23),
    sale(1190, 23),
    sale(1275, 24),
    sale(1080, 33),
  ];

  it("reads the move the edge test missed", () => {
    const r = slabComp(DARK_WEEZING, NOW)!;
    assert.ok(r.step, "3.5x median over median is a repricing");
    assert.equal(r.step!.direction, "up");
    assert.equal(r.price, 3950);
  });

  it("prices off October only, not a blend of both months", () => {
    const r = slabComp(DARK_WEEZING, NOW)!;
    assert.equal(r.used.length, 3);
    assert.deepEqual(r.used.map((s) => s.price), [3050, 3999.95, 3950]);
    assert.notEqual(r.price, 3050, "the blended answer");
  });

  it("still demands total separation, not just a median gap", () => {
    // Overlapping scatters are not two markets however far apart their
    // medians drift, so this must not fire.
    // High, low, high, low through time: no split anywhere separates the two
    // price levels, so there are not two levels, just a noisy card.
    const overlapping = [
      sale(3000, 2), sale(900, 4),
      sale(2950, 20), sale(800, 24), sale(2800, 26),
    ];
    assert.equal(detectStepChange(overlapping), null);
  });
});

describe("steps down", () => {
  it("reprices a card that crashed", () => {
    // Symmetric on purpose. Carrying a dead card at its old number is how it
    // ends up anchoring a surprise set.
    const rows = [sale(480, 1), sale(500, 4), sale(2000, 12), sale(2100, 16), sale(1900, 20)];
    const r = slabComp(rows, NOW)!;
    assert.ok(r.step);
    assert.equal(r.step!.direction, "down");
    assert.equal(r.price, 490);
    assert.equal(r.step!.from, 2000);
  });

  it("says so in the comp source", () => {
    const rows = [sale(480, 1), sale(500, 4), sale(2000, 12), sale(2100, 16), sale(1900, 20)];
    const src = slabCompSource({ grader: "CGC", grade: "9.5" }, slabComp(rows, NOW)!);
    assert.match(src, /repriced down/);
    assert.match(src, /CGC 9\.5/);
  });
});

describe("the step test classifies but never prices", () => {
  it("still honours a move that finished before the window opened", () => {
    // sl-v6. A card that repriced and then went quiet is still a repriced
    // card. Medianing its two levels together here would be the original bug
    // in a different branch, which is what the first cut of this did: it
    // answered $5,450, a price between the two markets and true in neither.
    const rows = [sale(9000, 45), sale(8800, 50), sale(2000, 70), sale(2100, 80)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.stale, true, "nothing has sold inside the window");
    assert.ok(r.step, "but the move still counts");
    assert.equal(r.price, 8900);
  });

  it("does not look further back than the step lookback for the old level", () => {
    // The $200 sales are over 90 days old, so there is no old level in range
    // and the recent sales are just the market.
    const rows = [sale(2000, 1), sale(2100, 4), sale(200, 200), sale(210, 240)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.step, undefined);
    assert.equal(r.price, 2050);
  });

  it("caps the newest level at SLAB_MAX_SALES", () => {
    const rows = [
      sale(9000, 1), sale(9100, 2), sale(9200, 3), sale(8900, 4),
      sale(9050, 5), sale(8950, 6), sale(9150, 7),
      sale(2000, 40), sale(2100, 50),
    ];
    const r = slabComp(rows, NOW)!;
    assert.ok(r.step);
    assert.equal(r.used.length, 5);
  });
});

describe("the wash-sale floor no longer keys off the high", () => {
  it("keeps the real sales when one absurd sale is present", () => {
    // sw-v2. The original bug, stated as the test that would have caught it:
    // 100, 110 and 900 used to keep ONLY the 900, because every genuine sale
    // sat below a fifth of the high.
    const rows = [{ price: 100 }, { price: 110 }, { price: 900 }];
    const kept = dropLowOutliers(rows);
    assert.equal(kept.length, 3, "no real sale should be evicted by the outlier");
  });

  it("still cuts a genuine lowball", () => {
    const rows = [{ price: 1000 }, { price: 1100 }, { price: 950 }, { price: 20 }];
    const kept = dropLowOutliers(rows);
    assert.equal(kept.length, 3);
    assert.ok(!kept.some((s) => s.price === 20));
  });

  it("falls back to the high when there are only two sales", () => {
    // No majority exists at n=2, so the original asymmetric assumption stands.
    // The alternative is a midpoint between a wash sale and a real one, which
    // is a price nobody would trade at.
    assert.deepEqual(dropLowOutliers([{ price: 100 }, { price: 900 }]), [{ price: 900 }]);
    assert.equal(dropLowOutliers([{ price: 700 }, { price: 900 }]).length, 2);
  });

  it("refuses to call an extreme gap a repricing", () => {
    // Over STEP_MAX_GAP the cheap cluster is wash trading, not a market the
    // card left. $20 and $25 followed two days later by $480-$520 is not a
    // 19x rally.
    const rows = [sale(520, 1), sale(500, 2), sale(480, 3), sale(25, 5), sale(20, 6)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.step, undefined);
    assert.equal(r.price, 500);
    assert.equal(r.dropped.length, 2, "handed back to the low-outlier filter");
  });

  it("admits a believable move and rejects an absurd one", () => {
    assert.equal(STEP_MAX_GAP, 10);
    const believable = [sale(9000, 1), sale(8800, 2), sale(2500, 20), sale(2400, 24)];
    assert.ok(detectStepChange(believable), "3.5x is a repricing");
    const absurd = [sale(9000, 1), sale(8800, 2), sale(100, 20), sale(110, 24)];
    assert.equal(detectStepChange(absurd), null, "80x is bad data");
  });

  it("never discards everything", () => {
    assert.equal(dropLowOutliers([{ price: 5 }]).length, 1);
    assert.equal(dropLowOutliers([]).length, 0);
  });

  it("exposes the same behaviour under the old name", () => {
    assert.equal(dropWashSales, dropLowOutliers);
  });
});

// sl-v6. Found by running the rule against live 130point data rather than
// against fixtures I wrote myself. Two more defects, both real.
describe("one recent sale the card's own history disagrees with", () => {
  // The Japanese Darkrai Prism Star, SM12a 077/173 PSA 10, exactly as 130point
  // had it on 2026-10-16. Four sales in August and September between $102 and
  // $193, then a single $784.90 on 14 October.
  const DARKRAI_JP: SaleRow[] = [
    sale(784.9, 2, { bestOffer: true, askingPrice: 947.49 }),
    sale(102.5, 33, { format: "AUCTION" }),
    sale(150.97, 37, { bestOffer: true, askingPrice: 185.8 }),
    sale(192.87, 42),
    sale(148.39, 47, { format: "AUCTION" }),
  ];

  it("does not take a lone sale 5x above the card's own history", () => {
    const r = slabComp(DARKRAI_JP, NOW)!;
    assert.notEqual(r.price, 785, "this is the number the first cut produced");
    assert.equal(r.price, 150);
  });

  it("names the sale it set aside", () => {
    const r = slabComp(DARKRAI_JP, NOW)!;
    assert.ok(r.demoted);
    assert.equal(r.demoted!.claimed, 784.9);
    const src = slabCompSource({ grader: "PSA", grade: "10" }, r);
    assert.match(src, /set aside/);
    assert.match(src, /784\.9/);
  });

  it("yields to the step test as soon as a second sale agrees", () => {
    // One print is noise, two is a market. Add a second sale near $784.90 and
    // the card reprices properly instead of being demoted.
    const withSecond = [sale(760, 1), ...DARKRAI_JP];
    const r = slabComp(withSecond, NOW)!;
    assert.equal(r.demoted, undefined);
    assert.ok(r.step);
    assert.equal(r.step!.direction, "up");
  });

  it("keeps the lone high when a sibling printing made the same move", () => {
    // Gabe's call, and the data backs it. The English Ultra Prism copy went
    // from a $2,000 September median to $9,000 in October, a 4.5x move. The
    // Japanese copy's lone sale is 5.2x its own September median. Those are
    // the same move, six days apart, on two printings that tracked each other
    // at 11-13x all year. Not an outlier: the second half of a repricing.
    const r = slabComp(DARKRAI_JP, NOW, {
      peerMove: { factor: 4.5, label: "English Ultra Prism 77/156" },
    })!;
    assert.equal(r.demoted, undefined);
    assert.equal(r.price, 785);
  });

  it("is not fooled by a sibling that moved a completely different amount", () => {
    // A 1.2x move on the English copy does not explain a 5.2x sale here.
    const r = slabComp(DARKRAI_JP, NOW, {
      peerMove: { factor: 1.2, label: "English Ultra Prism 77/156" },
    })!;
    assert.ok(r.demoted);
    assert.equal(r.price, 150);
  });

  it("is not fooled by a sibling that fell", () => {
    const r = slabComp(DARKRAI_JP, NOW, { peerMove: { factor: 0.3, label: "English" } })!;
    assert.ok(r.demoted);
  });

  it("reads a move factor back off a result so it can feed the sibling", () => {
    const en = slabComp(DARKRAI, NOW)!;
    const f = moveFactorOf(en);
    assert.ok(f && f > 1, "the English copy reports its own move");
    // And that factor, fed to the Japanese copy, is what rescues its lone sale.
    assert.equal(slabComp(DARKRAI_JP, NOW, { peerMove: { factor: f!, label: "EN" } })!.price, 785);
  });

  it("leaves a lone LOW sale alone", () => {
    // Asymmetric on purpose: a lone low is as likely to be the start of a real
    // decline as a wash sale, and the thin-sales flag already discloses it.
    const rows = [sale(40, 2), sale(102.5, 33), sale(150.97, 37), sale(192.87, 42)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.demoted, undefined);
    assert.equal(r.price, 40);
  });

  it("does nothing without enough history to outvote the sale", () => {
    const rows = [sale(784.9, 2), sale(102.5, 33)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.demoted, undefined);
    assert.equal(r.price, 785);
  });

  it("leaves a lone sale that merely differs alone", () => {
    const rows = [sale(220, 2), sale(190, 33), sale(200, 37), sale(180, 42)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.demoted, undefined);
    assert.equal(r.price, 220);
  });
});

describe("a stale card with history behind it", () => {
  // Misty's Gyarados 1st Edition PSA 9. Nothing inside 30 days, but nineteen
  // sales behind it. Taking the single newest meant taking the top auction
  // result off the pile.
  const MISTYS: SaleRow[] = [
    sale(1050.69, 54, { format: "AUCTION" }),
    sale(871, 61, { format: "AUCTION" }),
    sale(1150, 65, { bestOffer: true, askingPrice: 1499.99 }),
    sale(855.68, 78),
    sale(820, 82, { format: "AUCTION" }),
  ];

  it("medians the recent sales instead of taking the newest one", () => {
    const r = slabComp(MISTYS, NOW)!;
    assert.equal(r.stale, true);
    assert.notEqual(r.price, 1051, "the newest sale was the highest of the five");
    assert.equal(r.price, 871);
    assert.equal(r.used.length, 5);
  });

  it("says how many sales are behind a stale number", () => {
    const src = slabCompSource({ grader: "PSA", grade: "9" }, slabComp(MISTYS, NOW)!);
    assert.match(src, /median of 5/);
    assert.match(src, /none in 30d/);
  });

  it("still reads as one sale when that is all there is", () => {
    const r = slabComp([sale(300, 60)], NOW)!;
    assert.equal(r.stale, true);
    assert.equal(r.price, 300);
    assert.match(slabCompSource({ grader: "PSA", grade: "9" }, r), /last sale/);
  });
});

describe("the ordinary path is unchanged", () => {
  it("still takes the median of the newest five in the window", () => {
    // The lone $1,000 behind five sales near $100 must NOT read as a crash:
    // one sale cannot establish the level a card supposedly left. See
    // STEP_MIN_OLDER, which this case is the reason for.
    const rows = [sale(110, 1), sale(100, 2), sale(105, 3), sale(95, 4), sale(90, 5), sale(1000, 6)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.step, undefined);
    assert.equal(r.price, 100);
    assert.equal(r.used.length, 5);
  });

  it("needs two sales at the OLD level before calling it a step", () => {
    assert.equal(STEP_MIN_OLDER, 2);
    const oneOld = [sale(9000, 1), sale(8800, 3), sale(2000, 20)];
    assert.equal(detectStepChange(oneOld), null);
    const twoOld = [sale(9000, 1), sale(8800, 3), sale(2000, 20), sale(2100, 24)];
    assert.ok(detectStepChange(twoOld));
  });

  it("medians the older sales when the window is empty", () => {
    // sl-v6. Was "falls back to one older sale". Two sales that agree are
    // better evidence than whichever happens to be newer.
    const rows = [sale(300, 60), sale(280, 90)];
    const r = slabComp(rows, NOW)!;
    assert.equal(r.stale, true);
    assert.equal(r.price, 290);
    assert.equal(r.used.length, 2);
  });

  it("still returns null when there are no sales", () => {
    assert.equal(slabComp([], NOW), null);
  });

  it("still rounds up to whole dollars", () => {
    const rows = [sale(94.24, 1), sale(94.24, 2), sale(94.24, 3)];
    assert.equal(slabComp(rows, NOW)!.price, 95);
  });
});
