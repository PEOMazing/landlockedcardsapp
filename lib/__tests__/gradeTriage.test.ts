import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  COLD_RECHECK_DAYS, SHIP_PER_CARD, breakEven, gradingCost, isStaleSale, neededMultiple,
  netGain, overInsured, rankTriage, saleAgeDays, sweepBand, sweepCandidates, sweepRunsNeeded,
  triage, cardGroupKey, groupByCard, rollupSetUpside, MIN_SAMPLE, type TriageCard,
  gradeSetFromFloor, parseGradeSet, worstOfSet, setNet, gradeIsUsable, gradeCoverage, rankBySet,
  LIVE_RECHECK_DAYS, lotTitle, roundJump, suspectQuotes,
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

  it("is tripped by a dear grade even with no ten on record", () => {
    // gt-v7, and this test asserted the opposite until the real data showed
    // why that was wrong. The ceiling question is whether ANY outcome this
    // card could come back as is worth more than the tier will insure, so a
    // $4,000 nine is exactly the card to keep off a $1,000 submission whether
    // or not a ten has ever traded.
    const r = triage(card({ grades: { "9": { price: 4000, date: "2026-10-01" } } }), OPTS);
    assert.equal(r.overInsured, true);
  });

  it("is not tripped when every grade sits under the cap", () => {
    const r = triage(card({ grades: { "10": { price: 900, date: "2026-10-01" }, "9": { price: 300, date: "2026-10-01" } } }), OPTS);
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
  // A 9 under the 10 as well, so these cards have a curve. Without it every
  // card here rests on a single grade and the one-sale thinness rule marks
  // every row thin, which is correct behaviour and not what these particular
  // tests are about. Only the 10 is ticked below, so the 9 changes no figure.
  const mk = (id: string, setName: string, rarity: string, raw: number, p10: number) =>
    triage({
      id, name: id, setName, rarity, rawComp: raw,
      grades: {
        "10": { price: p10, date: "2026-10-01" },
        "9": { price: Math.max(1, Math.round(p10 / 2)), date: "2026-10-01" },
      },
    }, OPTS);

  it("groups by set AND rarity, because a set's commons and its art rares are not one population", () => {
    const rows = rollupSetUpside([
      mk("a", "Destined Rivals", "Art Rare", 50, 400),
      mk("b", "Destined Rivals", "Common", 1, 4),
    ], ["10"]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.rarity).sort(), ["Art Rare", "Common"]);
  });

  it("reports the share that clear the fee and the median multiple", () => {
    // five art rares at 8x raw, all clearing
    const rows = rollupSetUpside(
      ["a", "b", "c", "d", "e"].map((id) => mk(id, "Destined Rivals", "Art Rare", 50, 400)),
      ["10"],
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
    ], ["10"]);
    assert.equal(rows[0].medianMultiple, 2);
  });

  it("marks a small sample as thin rather than hiding it", () => {
    const rows = rollupSetUpside([mk("a", "S", "R", 10, 900)], ["10"]);
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].thin, true);
    assert.ok(MIN_SAMPLE >= 5);
  });

  it("never ranks a thin 100% above a solid 80%", () => {
    const solid = ["a", "b", "c", "d", "e"].map((id) => mk(id, "Solid", "R", 50, 400));
    solid.push(mk("f", "Solid", "R", 50, 60));   // one that does not clear
    const thin = [mk("z", "Thin", "R", 50, 400)];
    const rows = rollupSetUpside([...thin, ...solid], ["10"]);
    assert.equal(rows[0].setName, "Solid");
    assert.equal(rows[1].setName, "Thin");
  });

  it("leaves cards with no sale at that grade out of n entirely, not counted as failures", () => {
    const withSale = mk("a", "S", "R", 50, 400);
    const noSale = triage({ id: "b", name: "b", setName: "S", rarity: "R", rawComp: 50, grades: {} }, OPTS);
    const rows = rollupSetUpside([withSale, noSale], ["10"]);
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].share, 1);
  });

  it("totals the dollars on the table for the ones that clear", () => {
    const rows = rollupSetUpside([mk("a", "S", "R", 50, 400), mk("b", "S", "R", 50, 400)], ["10"]);
    assert.equal(rows[0].upside, 570.02);
  });
});

// gt-v7. The prices that were not real.
//
// Every fixture below is a sale the first live sweep actually returned over
// its first 240 cards. They are kept verbatim because invented examples would
// have been tidier and would not have caught the Lv.X case.
describe("prices that should not be believed", () => {
  describe("listings that are not one card", () => {
    it("catches a complete set sold as one lot", () => {
      // The real one, recorded as a $3,036.98 PSA 9 Mew.
      assert.equal(
        lotTitle("PSA 9 & 8 Japanese Southern Island Complete Set Tropical / Rainbow Island Mew"),
        true,
      );
    });

    it("catches two grades named in one title", () => {
      assert.equal(lotTitle("Charizard PSA 10 / 9"), true);
      assert.equal(lotTitle("Blastoise PSA 8 and 7"), true);
      assert.equal(lotTitle("Raichu PSA 9, 8"), true);
    });

    it("catches quantities", () => {
      assert.equal(lotTitle("Pikachu PSA 9 x2"), true);
      assert.equal(lotTitle("Pikachu PSA 9 2x"), true);
      assert.equal(lotTitle("Umbreon PSA 10 3 cards"), true);
      assert.equal(lotTitle("Mixed lot PSA 9"), true);
      assert.equal(lotTitle("Vintage binder PSA 8"), true);
    });

    it("does not read Lv.X as a quantity", () => {
      // The reason titles are stripped of Lv.X before anything else runs. The
      // bare X beside a collector number reads as a multiplier to every
      // quantity pattern there is, and Lv.X cards are exactly the generation
      // this tool is worth most on. Unstripped, the first of these is a lot
      // of ninety-nine Leafeons.
      assert.equal(lotTitle("Leafeon LV.X 99/100 Majestic Dawn Holo PSA 9"), false);
      assert.equal(lotTitle("2009 POKEMON SUPREME VICTORS #143 CHARIZARD G LV.X-HOLO PSA 10"), false);
      assert.equal(lotTitle("Palkia LV.X - DP18 PSA 8"), false);
    });

    it("does not mistake GX or EX for a quantity", () => {
      assert.equal(lotTitle("Weavile GX 74/236 PSA 10"), false);
      assert.equal(lotTitle("M Mewtwo EX 160 Full Art PSA 9"), false);
    });

    it("leaves an ordinary single-card title alone", () => {
      assert.equal(lotTitle("PSA 8 - 2009 Pokemon Platinum: Supreme Victors - Charizard G Lv.X Holo Rare"), false);
      assert.equal(lotTitle("1999 Pokemon Japanese Promo Mew Holo #151 Southern Island PSA 7 NM"), false);
      assert.equal(lotTitle(""), false);
      assert.equal(lotTitle(null), false);
      assert.equal(lotTitle(undefined), false);
    });
  });

  describe("round numbers far above the grade below", () => {
    it("catches the hundred-thousand-dollar Charizard", () => {
      // Right card, right grade, correct title, 14x the PSA 9 beneath it, at
      // an exact round hundred thousand. An asking price, not a sale.
      assert.equal(roundJump(100000, 7000), true);
    });

    it("needs the price to be round", () => {
      // Same enormous multiple, but $99,850 is a number somebody arrived at
      // rather than typed, so it is left alone and shown.
      assert.equal(roundJump(99850, 7000), false);
    });

    it("needs the jump as well as the roundness", () => {
      // $5,000 really is what some vintage slabs fetch. Round on its own is
      // not evidence of anything.
      assert.equal(roundJump(5000, 3000), false);
    });

    it("ignores prices under the floor", () => {
      // A round $2,000 over a $100 grade below is a plausible vintage curve,
      // and flagging it would cost more good cards than it saved.
      assert.equal(roundJump(2000, 100), false);
    });

    it("says nothing when there is no grade below to compare with", () => {
      // The absence of a comparison is not evidence. A card whose only sale
      // is a round $20,000 ten is on the check list for other reasons, not
      // this one.
      assert.equal(roundJump(20000, null), false);
      assert.equal(roundJump(20000, 0), false);
    });
  });

  describe("a grade priced above a better grade", () => {
    it("drops the lower grade, not the higher one", () => {
      // The real Leafeon: PSA 8 at $10,080 over a PSA 9 at $6,999.99. One of
      // those two is not a Leafeon and nothing here can tell which, so the
      // lower grade goes. That is the direction that removes the bigger claim
      // from the decision - an inflated 8 is what makes a card look like a
      // safe send, because the 8 is the easy outcome.
      const out = suspectQuotes({
        "9": { price: 6999.99, date: "2026-09-07", title: "PSA 9 Leafeon Holo 99/100 Majestic Dawn" },
        "8": { price: 10080, date: "2026-10-04", title: "NEW CERT 2008 Pokemon Leafeon Holo PSA 8 Majestic Dawn #99/100" },
      });
      assert.equal(out["8"], "inverted");
      assert.equal(out["9"], undefined);
    });

    it("accepts a curve that falls the way it should", () => {
      const out = suspectQuotes({
        "10": { price: 1200, date: "2026-10-01", title: "Card PSA 10" },
        "9": { price: 400, date: "2026-10-01", title: "Card PSA 9" },
        "8": { price: 150, date: "2026-10-01", title: "Card PSA 8" },
      });
      assert.deepEqual(out, {});
    });

    it("allows two grades at the same price", () => {
      // Thin markets do this and it is not a mistake.
      const out = suspectQuotes({
        "9": { price: 300, date: "2026-10-01", title: "Card PSA 9" },
        "8": { price: 300, date: "2026-10-01", title: "Card PSA 8" },
      });
      assert.deepEqual(out, {});
    });

    it("does not let a rejected price condemn the grades under it", () => {
      // The Mew, as it really came back. The PSA 9 is a lot at $3,036.98, far
      // above the $625 PSA 8. If the lot were allowed to set the ceiling it
      // would look like the 8 was fine and nothing else was wrong; if it were
      // allowed to BE the ceiling it would drag the 8 down with it. It is out
      // of the comparison entirely, so the 8 stands on its own.
      const out = suspectQuotes({
        "10": { price: 20000, date: "2026-10-07", title: "1999 POKEMON JAPANESE PROMO SOUTHERN ISLANDS #151 MEW-HOLO PSA 10" },
        "9": { price: 3036.98, date: "2026-10-13", title: "PSA 9 & 8 Japanese Southern Island Complete Set Tropical / Rainbow Island Mew" },
        "8": { price: 625, date: "2026-10-12", title: "Pokemon Mew Southern Island R.I. Japanese Holo Promo #151 PSA 8" },
        "7": { price: 380, date: "2026-10-14", title: "1999 Pokemon Japanese Promo Mew Holo #151 Southern Island PSA 7 NM" },
      });
      assert.equal(out["9"], "lot");
      // $20,000 round, and 32x the $625 eight once the lot is out of the way.
      assert.equal(out["10"], "round-jump");
      assert.equal(out["8"], undefined);
      assert.equal(out["7"], undefined);
    });

    it("leaves a card with no prices alone", () => {
      assert.deepEqual(suspectQuotes({}), {});
      assert.deepEqual(suspectQuotes({ "10": { price: null, date: null } }), {});
    });
  });
});

describe("triage with a price it does not believe", () => {
  const charizard = card({
    rawComp: 451,
    grades: {
      "10": { price: 100000, date: "2026-09-21", title: "2009 POKEMON PLATINUM SUPREME VICTORS #143 CHARIZARD G LV.X-HOLO PSA 10" },
      "9": { price: 7000, date: "2026-10-14", title: "2009 POKEMON PLATINUM SUPREME VICTORS #143 CHARIZARD G LV.X-HOLO PSA 9" },
      "8": { price: 2450, date: "2026-09-28", title: "PSA 8 - 2009 Pokemon Platinum: Supreme Victors - Charizard G Lv.X Holo Rare" },
    },
  });

  it("keeps the rejected price out of the net", () => {
    const r = triage(charizard, OPTS);
    assert.equal(r.byGrade["10"].price, null);
    assert.equal(r.byGrade["10"].net, null);
    assert.equal(r.byGrade["10"].suspect, "round-jump");
  });

  it("still shows what it threw away", () => {
    // Hiding it would make the card look unresearched when a sale was found
    // and disbelieved, and nobody could argue with a number they cannot see.
    const r = triage(charizard, OPTS);
    assert.equal(r.byGrade["10"].rejected, 100000);
    assert.match(String(r.byGrade["10"].title), /CHARIZARD G LV\.X/);
  });

  it("ranks the card on the evidence that survived", () => {
    const r = triage(charizard, OPTS);
    // The 9 at $7,000 against a $451 raw card and $64.99 of cost.
    assert.equal(r.bestGrade, "9");
    assert.equal(r.bestNet, 6484.01);
  });

  it("counts and names what it rejected", () => {
    const r = triage(charizard, OPTS);
    assert.equal(r.suspectCount, 1);
    assert.deepEqual(r.suspectReasons, ["round-jump"]);
    assert.equal(r.topRejected, 100000);
  });

  it("does not let the rejected ten be the reason for the ceiling warning", () => {
    // I wrote this test the wrong way round first: a rejected ten leaves the
    // ten null, so I asserted the card was no longer over the cap. It is - its
    // surviving PSA 9 last sold at $7,000 against a $1,000 tier. The rejection
    // stops the $100,000 being USED, it does not make the card cheap, and the
    // ceiling check has to read the dearest grade still standing.
    const r = triage(charizard, OPTS);
    assert.equal(r.byGrade["10"].price, null);
    assert.equal(r.overInsured, true);
  });

  it("reports a clean card as having rejected nothing", () => {
    const r = triage(card({ rawComp: 100, grades: { "10": { price: 400, date: "2026-10-01", title: "Card PSA 10" } } }), OPTS);
    assert.equal(r.suspectCount, 0);
    assert.deepEqual(r.suspectReasons, []);
    assert.equal(r.topRejected, null);
  });

  it("keeps a rejected grade out of the floor as well", () => {
    // floorNet walks high to low taking the worst net. A rejected grade must
    // be skipped like an absent one rather than counted as a zero net, which
    // would veto every floor beneath it.
    const r = triage(charizard, OPTS);
    assert.equal(r.floorNet["9"], 6484.01);
    assert.equal(r.floorNet["8"], 1934.01);
  });
});

describe("how often a card gets looked up again", () => {
  const checked = (days: number) =>
    new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);

  it("looks up a card nobody has priced straight away", () => {
    assert.deepEqual(
      sweepCandidates([{ comp: 5, checked: null, bestNet: null }], 10, { now: NOW }).length,
      1,
    );
  });

  it("does not re-look-up a live card the same day", () => {
    // This is the bug this constant exists for. due() used to read "the band
    // is not cold, so it is due", which made a card that had just been
    // checked AND had upside due again on the very next run. The first pass
    // still drained correctly, so it looked fine - and then the moment the
    // backlog ran out the sweep settled into re-pricing the same several
    // hundred good cards every fifteen minutes. Ninety-six runs a day at a
    // hundred and twenty cards is eleven thousand requests a day against a
    // plan of twenty-five thousand a MONTH.
    const rows = sweepCandidates([{ comp: 500, checked: checked(0), bestNet: 900 }], 10, { now: NOW });
    assert.deepEqual(rows, []);
  });

  it("comes back to a live card after a week", () => {
    const fresh = sweepCandidates([{ comp: 500, checked: checked(LIVE_RECHECK_DAYS - 1), bestNet: 900 }], 10, { now: NOW });
    const due = sweepCandidates([{ comp: 500, checked: checked(LIVE_RECHECK_DAYS), bestNet: 900 }], 10, { now: NOW });
    assert.equal(fresh.length, 0);
    assert.equal(due.length, 1);
  });

  it("still waits far longer on a hopeless one", () => {
    const mid = sweepCandidates([{ comp: 5, checked: checked(30), bestNet: -600 }], 10, { now: NOW });
    const old = sweepCandidates([{ comp: 5, checked: checked(COLD_RECHECK_DAYS), bestNet: -600 }], 10, { now: NOW });
    assert.equal(mid.length, 0);
    assert.equal(old.length, 1);
  });

  it("treats a timestamp it cannot read as due", () => {
    // A card whose last-checked date will not parse is a card we do not know
    // anything about, and guessing "fresh" would strand it forever.
    const rows = sweepCandidates([{ comp: 500, checked: "who knows", bestNet: 900 }], 10, { now: NOW });
    assert.equal(rows.length, 1);
  });

  it("puts the never-checked ahead of the refreshes", () => {
    const rows = sweepCandidates(
      [
        { comp: 10, checked: checked(400), bestNet: 900 },
        { comp: 900, checked: null, bestNet: null },
      ],
      10,
      { now: NOW },
    );
    assert.equal(rows[0].comp, 900);
  });
});

describe("a jump big enough to be worth a look", () => {
  const q = (price: number) => ({ price, date: "2026-10-01", title: "Card PSA x" });

  it("flags the top tenth of jumps without rejecting them", () => {
    // A marker, not a rejection. This is where the genuine low-pop finds live
    // as well as the misread listings, and the two are not separable from one
    // sale apiece - so it is said out loud rather than decided.
    const r = triage(card({ rawComp: 50, grades: { "10": q(1000), "9": q(100) } }), OPTS);
    assert.deepEqual(r.bigJump, { grade: "10", times: 10 });
    assert.equal(r.byGrade["10"].price, 1000);
    assert.equal(r.byGrade["10"].suspect, null);
    assert.equal(r.bestNet, 885.01);
  });

  it("says nothing about an ordinary curve", () => {
    // Median jump in the real data is 2.4x and p75 is 4.9x, so this is normal.
    assert.equal(triage(card({ rawComp: 50, grades: { "10": q(400), "9": q(100) } }), OPTS).bigJump, null);
  });

  it("takes the biggest jump when there are several", () => {
    const r = triage(card({ rawComp: 50, grades: { "10": q(2000), "9": q(150), "8": q(10) } }), OPTS);
    // 9 over 8 is 15x, 10 over 9 is 13.3x
    assert.deepEqual(r.bigJump, { grade: "9", times: 15 });
  });

  it("does not raise a jump off a price it rejected", () => {
    // The Charizard. Its PSA 10 is out, so the only surviving pair is the 9
    // over the 8 at 2.9x and there is nothing to flag. A warning generated by
    // a number nothing believes would be noise about noise.
    const r = triage(card({
      rawComp: 451,
      grades: {
        "10": { price: 100000, date: "2026-09-21", title: "CHARIZARD G LV.X-HOLO PSA 10" },
        "9": { price: 7000, date: "2026-10-14", title: "CHARIZARD G LV.X-HOLO PSA 9" },
        "8": { price: 2450, date: "2026-09-28", title: "Charizard G Lv.X Holo Rare PSA 8" },
      },
    }), OPTS);
    assert.equal(r.bigJump, null);
  });

  it("says nothing with only one price", () => {
    assert.equal(triage(card({ rawComp: 50, grades: { "10": q(5000) } }), OPTS).bigJump, null);
  });
});

describe("how many grades the case rests on", () => {
  const q = (price: number) => ({ price, date: "2026-10-01", title: "Card" });

  it("counts the grades that survived", () => {
    const r = triage(card({ rawComp: 50, grades: { "10": q(400), "9": q(200), "8": q(100) } }), OPTS);
    assert.equal(r.gradesWithPrice, 3);
  });

  it("calls out a card standing on a single grade", () => {
    // The blind spot in bigJump, and the reason this count exists. A card
    // whose only price is its PSA 10 has nothing beneath it to be compared
    // against, so no jump rule can ever flag it however wrong the number is,
    // and it sorts to the top looking as solid as a card with a full curve.
    const r = triage(card({ rawComp: 3, grades: { "10": q(4735) } }), OPTS);
    assert.equal(r.gradesWithPrice, 1);
    assert.equal(r.bigJump, null);
  });

  it("does not count a rejected grade towards the evidence", () => {
    const r = triage(card({
      rawComp: 100,
      grades: {
        "10": { price: 900, date: "2026-10-01", title: "Card PSA 10" },
        "9": { price: 500, date: "2026-10-01", title: "Mixed lot PSA 9" },
      },
    }), OPTS);
    assert.equal(r.gradesWithPrice, 1);
  });

  it("is zero on a card nobody found a sale for", () => {
    assert.equal(triage(card({ rawComp: 100 }), OPTS).gradesWithPrice, 0);
  });
});

describe("the insured ceiling after a price is rejected", () => {
  it("still warns on a card whose surviving grade is over the cap", () => {
    // The regression the rejection rules nearly introduced. The Charizard's
    // $100,000 ten is thrown out, so a check that only read the ten saw null
    // and passed the card - on a card whose PSA 9 last sold at $7,000, seven
    // times the $1,000 tier limit.
    const r = triage(card({
      rawComp: 451,
      grades: {
        "10": { price: 100000, date: "2026-09-21", title: "CHARIZARD G LV.X-HOLO PSA 10" },
        "9": { price: 7000, date: "2026-10-14", title: "CHARIZARD G LV.X-HOLO PSA 9" },
        "8": { price: 2450, date: "2026-09-28", title: "Charizard G Lv.X PSA 8" },
      },
    }), OPTS);
    assert.equal(r.byGrade["10"].price, null);
    assert.equal(r.overInsured, true);
  });

  it("warns off a grade below the ten when the ten has no sale at all", () => {
    const r = triage(card({ rawComp: 100, grades: { "9": { price: 2400, date: "2026-10-01", title: "Card PSA 9" } } }), OPTS);
    assert.equal(r.overInsured, true);
  });

  it("leaves a card inside the cap alone", () => {
    const r = triage(card({ rawComp: 100, grades: { "10": { price: 900, date: "2026-10-01", title: "Card PSA 10" } } }), OPTS);
    assert.equal(r.overInsured, false);
  });
});

// gt-v8. Picking the outcomes rather than a floor under them.
describe("a floor expressed as a set of grades", () => {
  it("is that grade and everything above it", () => {
    assert.deepEqual(gradeSetFromFloor("9"), ["10", "9"]);
    assert.deepEqual(gradeSetFromFloor("8"), ["10", "9", "8"]);
    assert.deepEqual(gradeSetFromFloor("10"), ["10"]);
    assert.deepEqual(gradeSetFromFloor("1").length, 10);
  });

  it("agrees with the old floor on every grade, which is why old links still work", () => {
    const r = triage(card({
      rawComp: 100,
      grades: {
        "10": { price: 900, date: "2026-10-01" },
        "9": { price: 400, date: "2026-10-01" },
        "8": { price: 150, date: "2026-10-01" },
      },
    }), OPTS);
    for (const g of ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"] as const) {
      assert.equal(setNet(r, gradeSetFromFloor(g)), r.floorNet[g], g);
    }
  });
});

describe("reading a grade set off a query string", () => {
  it("takes the grades in high-to-low order whatever order they arrive in", () => {
    assert.deepEqual(parseGradeSet("8,10,9"), ["10", "9", "8"]);
  });

  it("drops duplicates and junk", () => {
    assert.deepEqual(parseGradeSet("9,9,banana,9"), ["9"]);
    assert.deepEqual(parseGradeSet("10 9"), ["10", "9"]);
  });

  it("returns null rather than a default when there is nothing usable", () => {
    // An empty set and an absent one are different things, and only the caller
    // knows which it is looking at.
    assert.equal(parseGradeSet(""), null);
    assert.equal(parseGradeSet(null), null);
    assert.equal(parseGradeSet("11,0,99"), null);
  });
});

describe("the outcome that decides the card", () => {
  const r = triage(card({
    rawComp: 100,
    grades: {
      "10": { price: 2000, date: "2026-10-01" },
      "9": { price: 400, date: "2026-10-01" },
      "8": { price: 120, date: "2026-10-01" },
    },
  }), OPTS);

  it("is the worst of the ones you ticked, not the best", () => {
    // Ticking three grades and being shown the best of them would be picking
    // the outcomes and then ignoring the pick.
    assert.deepEqual(worstOfSet(r, ["10", "9", "8"]), { grade: "8", price: 120, net: -44.99 });
  });

  it("lets you ask a question no floor can ask", () => {
    // "This 9s or it 10s" - 8 and below deliberately excluded. There is no
    // floor that means this: a floor of 9 agrees, but nothing expresses {10,9}
    // while keeping out what a floor of 8 would drag in.
    assert.deepEqual(worstOfSet(r, ["10", "9"]), { grade: "9", price: 400, net: 235.01 });
    assert.equal(setNet(r, ["10"]), 1835.01);
  });

  it("skips a ticked grade with no sale instead of zeroing the card", () => {
    // Somebody ticking 10, 9 and 8 on a card that only ever sold as a 10
    // should be told what the 10 makes, not be given nothing.
    const only10 = triage(card({ rawComp: 100, grades: { "10": { price: 900, date: "2026-10-01" } } }), OPTS);
    assert.deepEqual(worstOfSet(only10, ["10", "9", "8"]), { grade: "10", price: 900, net: 735.01 });
  });

  it("is null when not one ticked grade has a price", () => {
    // "No evidence for the outcomes you asked about" is not "makes nothing".
    assert.equal(setNet(r, ["3", "2", "1"]), null);
    assert.equal(worstOfSet(r, ["3"]), null);
  });

  it("ignores a price the sanity rules rejected", () => {
    const withLot = triage(card({
      rawComp: 100,
      grades: {
        "10": { price: 5000, date: "2026-10-01", title: "Complete set PSA 10" },
        "9": { price: 400, date: "2026-10-01", title: "Card PSA 9" },
      },
    }), OPTS);
    assert.deepEqual(worstOfSet(withLot, ["10"]), null);
    assert.equal(setNet(withLot, ["10", "9"]), 235.01);
  });

  it("breaks a tie on the lower grade", () => {
    const flat = triage(card({
      rawComp: 100,
      grades: { "10": { price: 400, date: "2026-10-01" }, "9": { price: 400, date: "2026-10-01" } },
    }), OPTS);
    assert.equal(worstOfSet(flat, ["10", "9"])!.grade, "9");
  });

  it("falls back to every grade on an empty set", () => {
    // A page with nothing ticked should show the whole picture rather than an
    // empty table that looks like a data problem.
    assert.equal(setNet(r, []), -44.99);
  });
});

describe("which grades are worth offering as a tick box", () => {
  const r = triage(card({
    rawComp: 100,
    grades: {
      "10": { price: 5000, date: "2026-10-01", title: "Mixed lot PSA 10" },
      "9": { price: 400, date: "2026-10-01", title: "Card PSA 9" },
    },
  }), OPTS);

  it("offers a grade with a price that survived", () => {
    assert.equal(gradeIsUsable(r, "9"), true);
  });

  it("does not offer one with no sale, or one that was rejected", () => {
    assert.equal(gradeIsUsable(r, "7"), false);
    assert.equal(gradeIsUsable(r, "10"), false);
  });

  it("counts how many cards each grade would actually get you", () => {
    const other = triage(card({ rawComp: 50, grades: { "9": { price: 300, date: "2026-10-01" }, "8": { price: 100, date: "2026-10-01" } } }), OPTS);
    const cov = gradeCoverage([r, other]);
    assert.equal(cov["9"], 2);
    assert.equal(cov["8"], 1);
    assert.equal(cov["10"], 0);
    assert.equal(cov["1"], 0);
  });
});

describe("the condition of the copy in hand", () => {
  it("rides along on the row", () => {
    assert.equal(triage(card({ condition: "LP" }), OPTS).condition, "LP");
  });

  it("defaults to Raw rather than empty", () => {
    assert.equal(triage(card(), OPTS).condition, "Raw");
  });

  it("does not change the graded price, only what the copy costs to give up", () => {
    // The distortion the column exists to expose. Same card, same PSA 10
    // sale; the LP copy nets $150 MORE purely because its raw comp is lower,
    // while being far less likely to come back a 10 at all. The maths is
    // right and reading it without the condition in front of you is not.
    const grades = { "10": { price: 900, date: "2026-10-01" } };
    const nm = triage(card({ condition: "NM", rawComp: 200, grades }), OPTS);
    const lp = triage(card({ condition: "LP", rawComp: 50, grades }), OPTS);
    assert.equal(nm.byGrade["10"].price, lp.byGrade["10"].price);
    assert.equal(lp.bestNet! - nm.bestNet!, 150);
  });
});

describe("ranking by the outcomes ticked", () => {
  const mk = (id: string, raw: number, prices: Partial<Record<"10" | "9" | "8", number>>) =>
    triage({
      id, name: id, rawComp: raw,
      grades: Object.fromEntries(
        Object.entries(prices).map(([g, p]) => [g, { price: p, date: "2026-10-01", title: `${id} PSA ${g}` }]),
      ),
    }, OPTS);

  it("orders by the net the table is printing, not the best across all grades", () => {
    // Caught by running the real binder through it. Ranked on bestNet the NM
    // list opened with a card whose best grade was a 10 the tick set excluded,
    // sitting above one worth three times as much at the ticked grades.
    const bestIsExcluded = mk("infernape", 200, { "10": 24100, "9": 3050 });
    const bestIsTicked = mk("hitmonlee", 45, { "10": 9099 });
    const rows = rankBySet([bestIsExcluded, bestIsTicked], ["10"]);
    assert.equal(rows[0].id, "infernape");
    // Tick the 9 as well and the order flips, because the Infernape is now
    // judged on its $3,050 nine while the Hitmonlee keeps its ten.
    assert.equal(rankBySet([bestIsExcluded, bestIsTicked], ["10", "9"])[0].id, "hitmonlee");
  });

  it("sinks a card with no sale at the ticked grades below one that has any", () => {
    const has = mk("has", 50, { "9": 300 });
    const hasnt = mk("hasnt", 5000, { "10": 90000 });
    const rows = rankBySet([hasnt, has], ["9"]);
    assert.equal(rows[0].id, "has");
    assert.equal(rows[1].id, "hasnt");
  });

  it("falls back to the dearer raw card when neither has evidence", () => {
    const rows = rankBySet([mk("cheap", 5, {}), mk("dear", 900, {})], ["9"]);
    assert.equal(rows[0].id, "dear");
  });
});

describe("a buying row built out of single sales", () => {
  const one = (id: string, set: string, rarity: string, raw: number, p10: number) =>
    triage({ id, name: id, setName: set, rarity, rawComp: raw, grades: { "10": { price: p10, date: "2026-10-01" } } }, OPTS);
  const full = (id: string, set: string, rarity: string, raw: number) =>
    triage({
      id, name: id, setName: set, rarity, rawComp: raw,
      grades: { "10": { price: raw * 8, date: "2026-10-01" }, "9": { price: raw * 4, date: "2026-10-01" } },
    }, OPTS);

  it("is marked thin however many cards are in it", () => {
    // The real one: XY Base Set commons came back top of the buy list at a
    // 1,578x median on six cards and NOT marked thin, because six clears the
    // sample floor. All six were $3 raw cards with a single PSA 10 sale and
    // nothing beneath it to argue with.
    const rows = rollupSetUpside(
      ["a", "b", "c", "d", "e", "f"].map((id) => one(id, "XY Base Set", "Common", 3, 4735)),
      ["10"],
    );
    assert.equal(rows[0].n, 6);
    assert.equal(rows[0].oneGrade, 6);
    assert.equal(rows[0].thin, true);
  });

  it("is not marked thin when most cards have a curve under them", () => {
    const group = [
      ...["a", "b", "c", "d"].map((id) => full(id, "S", "R", 100)),
      one("e", "S", "R", 100, 900),
    ];
    const rows = rollupSetUpside(group, ["10"]);
    assert.equal(rows[0].oneGrade, 1);
    assert.equal(rows[0].thin, false);
  });

  it("sorts a one-sale row below a row with real evidence", () => {
    const junk = ["a", "b", "c", "d", "e", "f"].map((id) => one(id, "Junk", "Common", 3, 4735));
    const real = ["g", "h", "i", "j", "k", "l"].map((id) => full(id, "Real", "Rare", 200));
    const rows = rollupSetUpside([...junk, ...real], ["10"]);
    assert.equal(rows[0].setName, "Real");
  });
});
