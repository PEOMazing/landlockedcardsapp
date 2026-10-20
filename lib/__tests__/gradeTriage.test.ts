import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  COLD_RECHECK_DAYS, SHIP_PER_CARD, breakEven, gradingCost, isStaleSale, neededMultiple,
  netGain, overInsured, rankTriage, saleAgeDays, sweepBand, sweepCandidates, sweepRunsNeeded,
  triage, cardGroupKey, groupByCard, rollupSetUpside, MIN_SAMPLE, type TriageCard,
} from "../gradeTriage";

const NOW = new Date("2026-10-20T12:00:00Z");
const FEE = 59.99;            // Gabe's open tier, bulk is closed to him
const MAX_INSURED = 1000;
const COST = FEE + SHIP_PER_CARD;   // 64.99
const OPTS = { fee: FEE, maxInsured: MAX_INSURED, now: NOW };

const card = (over: Partial<TriageCard> = {}): TriageCard => ({
  id: "rec1", name: "Card", rawComp: 100, grades: {}, ...over,
});

describe("what grading costs", () => {
  it("is the fee plus shipping both ways", () => {
    assert.equal(gradingCost(59.99), 64.99);
  });

  it("break-even is the raw card plus the whole cost, because you give the raw card up", () => {
    assert.equal(breakEven(100, COST), 164.99);
  });

  it("the multiple needed falls as the card gets dearer - a fixed fee is a rich-card game", () => {
    assert.equal(neededMultiple(25, COST), 3.6);
    assert.equal(neededMultiple(50, COST), 2.3);
    assert.equal(neededMultiple(100, COST), 1.65);
    assert.equal(neededMultiple(200, COST), 1.32);
  });

  it("has no answer for a card with no raw comp, rather than pretending it is free", () => {
    assert.equal(breakEven(null, COST), null);
    assert.equal(neededMultiple(0, COST), null);
  });
});

describe("net gain per grade", () => {
  it("is what you make after giving up the raw card and paying the fee", () => {
    assert.equal(netGain(100, 400, COST), 235.01);
  });

  it("goes negative when the fee eats it, and says so rather than clamping at zero", () => {
    assert.equal(netGain(100, 120, COST), -44.99);
  });

  it("is null when there is no graded sale - an absence is not a $0 profit", () => {
    assert.equal(netGain(100, null, COST), null);
    assert.equal(netGain(100, 0, COST), null);
  });
});

describe("the cheap card with a big ten - the case Gabe caught", () => {
  // "there's also some cards that could be $5 but in a 10 are worth $500"
  const cheap = card({ rawComp: 5, grades: { "10": { price: 500, date: "2026-10-01" } } });

  it("is the best card in the binder, not a rounding error", () => {
    const r = triage(cheap, OPTS);
    assert.equal(r.byGrade["10"].net, 430.01);
    assert.equal(r.bestGrade, "10");
  });

  it("beats a dear card with a dull multiple, which is the whole point of ranking by net", () => {
    const dull = card({ id: "rec2", rawComp: 200, grades: { "10": { price: 280, date: "2026-10-01" } } });
    const [first] = rankTriage([triage(dull, OPTS), triage(cheap, OPTS)]);
    assert.equal(first.id, "rec1");
  });

  it("is never filtered out of a sweep for being cheap", () => {
    const picked = sweepCandidates([{ comp: 5 }, { comp: 900 }], 10);
    assert.equal(picked.length, 2);
  });
});

describe("picking the grade to lean on", () => {
  it("takes the best net across the three", () => {
    const r = triage(card({
      rawComp: 50,
      grades: {
        "10": { price: 400, date: "2026-10-01" },
        "9": { price: 180, date: "2026-10-01" },
        "8": { price: 70, date: "2026-10-01" },
      },
    }), OPTS);
    assert.equal(r.bestGrade, "10");
    assert.equal(r.bestNet, 285.01);
    assert.equal(r.byGrade["8"].net, -44.99);
  });

  it("on a tie it names the LOWER grade, because that is the easier outcome", () => {
    const r = triage(card({
      rawComp: 50,
      grades: { "10": { price: 200, date: "2026-10-01" }, "9": { price: 200, date: "2026-10-01" } },
    }), OPTS);
    assert.equal(r.bestGrade, "9");
  });

  it("has no best grade at all when nothing has sold", () => {
    const r = triage(card({ grades: {} }), OPTS);
    assert.equal(r.bestNet, null);
    assert.equal(r.bestGrade, null);
  });
});

describe("the tier's insured ceiling", () => {
  it("is judged on the GRADED price, not the raw one", () => {
    assert.equal(overInsured(2400, MAX_INSURED), true);
    assert.equal(overInsured(900, MAX_INSURED), false);
  });

  it("flags the card you must not put on a $1,000 submission", () => {
    const r = triage(card({ rawComp: 700, grades: { "10": { price: 2400, date: "2026-10-01" } } }), OPTS);
    assert.equal(r.overInsured, true);
  });

  it("is not tripped by a card with no ten on record", () => {
    const r = triage(card({ grades: { "9": { price: 4000, date: "2026-10-01" } } }), OPTS);
    assert.equal(r.overInsured, false);
  });
});

describe("how old the evidence is", () => {
  it("counts days", () => {
    assert.equal(saleAgeDays("2026-10-10", NOW), 10);
  });

  it("treats anything past six months as history rather than price", () => {
    assert.equal(isStaleSale("2026-10-01", NOW), false);
    assert.equal(isStaleSale("2025-11-01", NOW), true);
  });

  it("is null, not zero, for a missing or malformed date", () => {
    assert.equal(saleAgeDays(null, NOW), null);
    assert.equal(saleAgeDays("last tuesday", NOW), null);
  });

  it("marks a card whose every price is old", () => {
    const r = triage(card({
      grades: { "10": { price: 400, date: "2024-01-01" }, "9": { price: 200, date: "2024-02-01" } },
    }), OPTS);
    assert.equal(r.allStale, true);
  });

  it("does not mark one that has a single fresh price", () => {
    const r = triage(card({
      grades: { "10": { price: 400, date: "2024-01-01" }, "9": { price: 200, date: "2026-10-15" } },
    }), OPTS);
    assert.equal(r.allStale, false);
  });
});

describe("ranking", () => {
  it("puts cards never looked at BELOW cards known to be worthless", () => {
    // "we have not looked" is not "not worth it", but it is also not evidence,
    // so it must not outrank a real negative or it would top the list forever.
    const unknown = triage(card({ id: "u", grades: {} }), OPTS);
    const bad = triage(card({ id: "b", rawComp: 100, grades: { "10": { price: 110, date: "2026-10-01" } } }), OPTS);
    assert.deepEqual(rankTriage([unknown, bad]).map((r) => r.id), ["b", "u"]);
  });

  it("orders unknowns by raw value so the dear ones get looked at first", () => {
    const cheap = triage(card({ id: "c", rawComp: 5, grades: {} }), OPTS);
    const dear = triage(card({ id: "d", rawComp: 900, grades: {} }), OPTS);
    assert.deepEqual(rankTriage([cheap, dear]).map((r) => r.id), ["d", "c"]);
  });
});

describe("which cards the next sweep spends calls on", () => {
  const never = { comp: 10, checked: null as string | null };
  const live = { comp: 10, checked: "2026-10-01", bestNet: 120 };
  const nearMiss = { comp: 10, checked: "2026-10-01", bestNet: -10 };
  const cold = { comp: 10, checked: "2026-10-01", bestNet: -400 };

  it("sorts them into never-looked, has-a-case, and hopeless", () => {
    assert.equal(sweepBand(never, 25), "new");
    assert.equal(sweepBand(live, 25), "live");
    assert.equal(sweepBand(nearMiss, 25), "live");
    assert.equal(sweepBand(cold, 25), "cold");
  });

  it("spends on never-looked first - discovery is paid once, refresh is forever", () => {
    const picked = sweepCandidates([cold, live, never], 1, { now: NOW });
    assert.equal(picked[0], never);
  });

  it("then on the ones with a case", () => {
    const picked = sweepCandidates([cold, live], 1, { now: NOW });
    assert.equal(picked[0], live);
  });

  it("leaves a hopeless card alone until it has gone properly stale", () => {
    const recent = { comp: 10, checked: "2026-10-18", bestNet: -400 };
    assert.deepEqual(sweepCandidates([recent], 10, { now: NOW }), []);
    const old = { comp: 10, checked: "2026-01-01", bestNet: -400 };
    assert.equal(sweepCandidates([old], 10, { now: NOW }).length, 1);
    assert.ok(COLD_RECHECK_DAYS > 90);
  });

  it("does the dearest unlooked-at cards first, so day one pays for itself", () => {
    const a = { comp: 5, checked: null };
    const b = { comp: 800, checked: null };
    assert.equal(sweepCandidates([a, b], 1)[0], b);
  });

  it("never starves an old card for a dearer one inside the same band", () => {
    const stale = { comp: 10, checked: "2026-08-01", bestNet: 50 };
    const fresh = { comp: 900, checked: "2026-10-19", bestNet: 50 };
    assert.equal(sweepCandidates([fresh, stale], 1, { now: NOW })[0], stale);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 50 }, () => ({ comp: 10, checked: null }));
    assert.equal(sweepCandidates(many, 20).length, 20);
  });

  it("says how many runs the first pass takes", () => {
    assert.equal(sweepRunsNeeded(1469, 100), 15);
    assert.equal(sweepRunsNeeded(0, 100), 0);
  });
});

describe("assuming a floor grade", () => {
  // "I can select PSA 10, 9, 8 and it shows the cards it's recommended if it
  // got a minimum of an 8." The floor question is about the WORST outcome at
  // or above that grade, not that grade on its own.
  const r = triage(card({
    rawComp: 50,
    grades: {
      "10": { price: 400, date: "2026-10-01" },
      "9": { price: 200, date: "2026-10-01" },
      "8": { price: 80, date: "2026-10-01" },
      "1": { price: 20, date: "2026-10-01" },
    },
  }), OPTS);

  it("a floor of 10 is just the ten", () => {
    assert.equal(r.floorNet["10"], 285.01);
  });

  it("a floor of 9 is the worse of the 9 and the 10", () => {
    assert.equal(r.floorNet["9"], 85.01);
  });

  it("a floor of 8 drops to the eight, which here does not clear the fee", () => {
    assert.equal(r.floorNet["8"], -34.99);
  });

  it("carries the worst all the way down to 1", () => {
    assert.equal(r.floorNet["1"], -94.99);
  });

  it("skips grades with no sale rather than treating them as worthless", () => {
    // No 7, 6, 5 on record. A floor of 6 must still read as the 8's number,
    // not as zero, or every thin card fails every floor test.
    assert.equal(r.floorNet["6"], r.floorNet["8"]);
  });

  it("is null all the way down when the card has no graded sales at all", () => {
    const none = triage(card({ grades: {} }), OPTS);
    assert.equal(none.floorNet["10"], null);
    assert.equal(none.floorNet["1"], null);
  });

  it("protects against the thin-market case where a 9 sold under its 8", () => {
    const noisy = triage(card({
      rawComp: 10,
      grades: { "10": { price: 300, date: "2026-10-01" }, "9": { price: 40, date: "2026-10-01" }, "8": { price: 120, date: "2026-10-01" } },
    }), OPTS);
    // A floor of 8 must not quote the 8's healthy net while the 9 below it is
    // a loss - the floor is the worst you might get, and you might get the 9.
    assert.equal(noisy.byGrade["8"].net, 45.01);
    assert.equal(noisy.floorNet["8"], -34.99);
  });
});

describe("one lookup per card, however many copies", () => {
  const base = { name: "Charizard", setName: "Base Set", number: "4/102", printing: "Unlimited", language: "English" };

  it("ignores condition - a graded price belongs to the card, not your copy", () => {
    assert.equal(cardGroupKey({ ...base }), cardGroupKey({ ...base }));
    const g = groupByCard([
      { ...base, condition: "NM" }, { ...base, condition: "LP" }, { ...base, condition: "DM" },
    ] as any[]);
    assert.equal(g.size, 1);
    assert.equal([...g.values()][0].length, 3);
  });

  it("treats 4/102 and 004/102 and 4 as the same card", () => {
    assert.equal(cardGroupKey({ ...base, number: "004/102" }), cardGroupKey(base));
    assert.equal(cardGroupKey({ ...base, number: "4" }), cardGroupKey(base));
  });

  it("keeps printings apart - 1st Edition is a different market", () => {
    assert.notEqual(cardGroupKey({ ...base, printing: "1st Edition" }), cardGroupKey(base));
  });

  it("keeps languages apart", () => {
    assert.notEqual(cardGroupKey({ ...base, language: "Japanese" }), cardGroupKey(base));
  });

  it("treats a blank language as English, so old records group with new ones", () => {
    assert.equal(cardGroupKey({ ...base, language: "" }), cardGroupKey(base));
  });

  it("keeps a promo code whole instead of parsing it to a number", () => {
    const a = cardGroupKey({ ...base, number: "SM201" });
    const b = cardGroupKey({ ...base, number: "SM202" });
    assert.notEqual(a, b);
  });

  it("thirty copies cost one request", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({ ...base, condition: i % 2 ? "NM" : "LP" }));
    assert.equal(groupByCard(thirty as any[]).size, 1);
  });
});

describe("which sets are worth buying to grade", () => {
  const mk = (id: string, setName: string, rarity: string, raw: number, p10: number) =>
    triage({ id, name: id, setName, rarity, rawComp: raw, grades: { "10": { price: p10, date: "2026-10-01" } } }, OPTS);

  it("groups by set AND rarity, because a set's commons and its art rares are not one population", () => {
    const rows = rollupSetUpside([
      mk("a", "Destined Rivals", "Art Rare", 50, 400),
      mk("b", "Destined Rivals", "Common", 1, 4),
    ], "10");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.rarity).sort(), ["Art Rare", "Common"]);
  });

  it("reports the share that clear the fee and the median multiple", () => {
    // five art rares at 8x raw, all clearing
    const rows = rollupSetUpside(
      ["a", "b", "c", "d", "e"].map((id) => mk(id, "Destined Rivals", "Art Rare", 50, 400)),
      "10",
    );
    assert.equal(rows[0].n, 5);
    assert.equal(rows[0].clearing, 5);
    assert.equal(rows[0].share, 1);
    assert.equal(rows[0].medianMultiple, 8);
    assert.equal(rows[0].thin, false);
  });

  it("uses a MEDIAN, so one chase card cannot drag the set somewhere no card lives", () => {
    const rows = rollupSetUpside([
      mk("a", "S", "R", 10, 20), mk("b", "S", "R", 10, 20), mk("c", "S", "R", 10, 20),
      mk("d", "S", "R", 10, 20), mk("e", "S", "R", 10, 9000),
    ], "10");
    assert.equal(rows[0].medianMultiple, 2);
  });

  it("marks a small sample as thin rather than hiding it", () => {
    const rows = rollupSetUpside([mk("a", "S", "R", 10, 900)], "10");
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].thin, true);
    assert.ok(MIN_SAMPLE >= 5);
  });

  it("never ranks a thin 100% above a solid 80%", () => {
    const solid = ["a", "b", "c", "d", "e"].map((id) => mk(id, "Solid", "R", 50, 400));
    solid.push(mk("f", "Solid", "R", 50, 60));   // one that does not clear
    const thin = [mk("z", "Thin", "R", 50, 400)];
    const rows = rollupSetUpside([...thin, ...solid], "10");
    assert.equal(rows[0].setName, "Solid");
    assert.equal(rows[1].setName, "Thin");
  });

  it("leaves cards with no sale at that grade out of n entirely, not counted as failures", () => {
    const withSale = mk("a", "S", "R", 50, 400);
    const noSale = triage({ id: "b", name: "b", setName: "S", rarity: "R", rawComp: 50, grades: {} }, OPTS);
    const rows = rollupSetUpside([withSale, noSale], "10");
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].share, 1);
  });

  it("totals the dollars on the table for the ones that clear", () => {
    const rows = rollupSetUpside([mk("a", "S", "R", 50, 400), mk("b", "S", "R", 50, 400)], "10");
    assert.equal(rows[0].upside, 570.02);
  });
});
