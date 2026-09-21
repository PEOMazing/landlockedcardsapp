import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseCsv, readWhatnotCsv, matchProduct, checkAgainstSet, tokens, splitGiveaways, showsIn, suggestShow, localDate, packMultiplier, storeRows, pickShow, type WhatnotSale } from "../whatnotCsv";

const S = (o: Partial<WhatnotSale>): WhatnotSale => ({ row: 2, title: "", description: "", qty: 1, price: 10, date: "", buyer: "", status: "", giveaway: false, showId: "", showTitle: "", ...o });

describe("parseCsv", () => {
  it("handles quotes, commas and newlines inside a field", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\n');
    assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'he said "hi"', "line\nbreak"]]);
  });
  it("skips blank lines and a byte order mark", () => {
    assert.deepEqual(parseCsv("﻿a\n\n1\n"), [["a"], ["1"]]);
  });
});

describe("readWhatnotCsv", () => {
  it("finds columns by name wherever they sit", () => {
    const csv = "order id,buyer,sold price,product name,product quantity,order status\n1,ash,$12.50,Darkness Ablaze Booster Pack,2,Completed\n2,misty,$5,Spin #3,1,Cancelled\n";
    const r = readWhatnotCsv(csv);
    assert.equal(r.error, null);
    assert.equal(r.sales.length, 1);
    assert.equal(r.skipped, 1);
    assert.deepEqual([r.sales[0].title, r.sales[0].qty, r.sales[0].price, r.sales[0].buyer], ["Darkness Ablaze Booster Pack", 2, 12.5, "ash"]);
  });
  it("says so when the file is not a sales export", () => {
    assert.match(readWhatnotCsv("foo,bar\n1,2\n").error || "", /product name/);
  });
});

describe("matchProduct", () => {
  const products = [
    { id: "p1", name: "Darkness Ablaze Booster Pack" },
    { id: "p2", name: "Darkness Ablaze" },
    { id: "p3", name: "Chaos Rising Booster Bundle" },
  ];
  it("prefers the most specific product whose words all appear", () => {
    assert.equal(matchProduct({ title: "POKEMON Darkness Ablaze booster pack x1", description: "" }, products)?.id, "p1");
    assert.equal(matchProduct({ title: "Darkness Ablaze sleeved", description: "" }, products)?.id, "p2");
  });
  it("looks in the description too, and returns null when nothing fits", () => {
    assert.equal(matchProduct({ title: "Spin #12", description: "chaos rising booster bundle" }, products)?.id, "p3");
    assert.equal(matchProduct({ title: "Spin #12", description: "" }, products), null);
  });
  it("ignores filler words", () => {
    assert.deepEqual(tokens("Pokemon TCG: The Darkness & Ablaze"), ["darkness", "ablaze"]);
  });
});

describe("checkAgainstSet", () => {
  const products = [{ id: "p1", name: "Darkness Ablaze Booster Pack" }, { id: "p3", name: "Chaos Rising Booster Bundle" }];
  const sales = [
    S({ title: "Darkness Ablaze Booster Pack", qty: 3, price: 18 }),
    S({ title: "Chaos Rising Booster Bundle", price: 40 }),
    S({ title: "Mystery spin" }),
  ];
  it("flags a product that sold but was never on the set", () => {
    const r = checkAgainstSet(sales, products, { p3: { onSet: 2, hit: 1 } });
    assert.equal(r.rows[0].product?.id, "p1");
    assert.equal(r.rows[0].status, "not-on-set");
    assert.equal(r.rows[0].sold, 3);
    assert.deepEqual(r.counts, { ok: 1, "not-on-set": 1, "count-off": 0, "no-match": 1 });
  });
  it("flags a count that does not line up with the hits recorded", () => {
    const r = checkAgainstSet(sales, products, { p1: { onSet: 5, hit: 2 }, p3: { onSet: 1, hit: 1 } });
    assert.equal(r.rows.find((x) => x.product?.id === "p1")!.status, "count-off");
  });
});

describe("weekly earnings report", () => {
  const csv = [
    '"TRANSACTION_TYPE","ORDER_PLACED_AT_UTC","LISTING_TITLE","LISTING_DESCRIPTION","BUY_FORMAT","QUANTITY_SOLD","LIVESTREAM_ID","LIVESTREAM_TITLE","BUYER_NAME","ORIGINAL_ITEM_PRICE"',
    '"ORDER_EARNINGS","2026-09-19 02:46:30","TONS OF RARE BANGERS - BRILLIANT FANTASY PACK!","SHIPPED SEALED","AUCTION",1,"b","BANGER SPINS WITH DESTINEE","x","12.00"',
    '"ORDER_EARNINGS","2026-09-19 03:00:00","FREE SINGLE #1","FREE","GIVEAWAY",1,"b","BANGER SPINS WITH DESTINEE","y","0.00"',
    '"TIP","2026-09-19 03:10:00","","","","","b","BANGER SPINS WITH DESTINEE","z",""',
    '"ORDER_EARNINGS","2026-09-18 18:03:36","MASSIVE CHASES - 5x Darkness Ablaze Booster Packs","","AUCTION",1,"a","SPCS WITH ALYSSA","w","30.00"',
  ].join("\n");
  const r = readWhatnotCsv(csv);
  it("keeps orders, drops tips, and reads the show on each order", () => {
    assert.equal(r.sales.length, 3);
    assert.equal(r.skipped, 1);
    assert.equal(r.sales[1].giveaway, true);
    assert.equal(r.sales[0].showTitle, "BANGER SPINS WITH DESTINEE");
  });
  it("counts giveaways by format even when the price column is blank or zero", () => {
    const g = splitGiveaways(r.sales);
    assert.equal(g.freeSingles, 1);
    assert.equal(g.paid.length, 2);
  });
  it("lists the shows in order and turns UTC into the local show day", () => {
    const shows = showsIn(r.sales);
    assert.deepEqual(shows.map((s) => s.id), ["a", "b"]);
    assert.equal(localDate("2026-09-19 02:46:30"), "2026-09-18");
    assert.equal(localDate("2026-09-18 18:03:36"), "2026-09-18");
  });
  it("picks the show for a stream by day and streamer", () => {
    const shows = showsIn(r.sales);
    assert.equal(suggestShow(shows, { date: "2026-09-18", streamer: "Destinee Smith" }), "b");
    assert.equal(suggestShow(shows, { date: "2026-09-18", streamer: "Alyssa" }), "a");
    assert.equal(suggestShow(shows, { date: "2026-09-10", streamer: "Alyssa" }), "");
  });
});

describe("shorthand in titles", () => {
  const products = [
    { id: "etb", name: "Phantasmal Flames Elite Trainer Box" },
    { id: "bb", name: "Perfect Order Booster Bundle" },
    { id: "da", name: "Darkness Ablaze Booster Pack" },
  ];
  it("spells out ETB, BB and plurals", () => {
    assert.equal(matchProduct({ title: "PHANTASMAL FLAMES ETB", description: "" }, products)?.id, "etb");
    assert.equal(matchProduct({ title: "PERFECT ORDER BB", description: "" }, products)?.id, "bb");
    assert.equal(matchProduct({ title: "5x Darkness Ablaze Booster Packs", description: "" }, products)?.id, "da");
  });
});

describe("store sales", () => {
  it("reads the pack count off the front of a listing", () => {
    assert.equal(packMultiplier("5x Darkness Ablaze Booster Packs"), 5);
    assert.equal(packMultiplier("10X Gem Pack"), 10);
    assert.equal(packMultiplier("Darkness Ablaze Booster Pack"), 1);
    assert.equal(packMultiplier("1 in 5 BANGERS - Gem 4"), 1);
  });
  it("takes Buy It Now orders from the earnings report and skips spins, giveaways and shipping", () => {
    const { rows, guessed } = storeRows([
      S({ title: "5x Obsidian Flames Packs - Ripped Live", price: 79, format: "BUY_IT_NOW", orderId: "11" }),
      S({ title: "SHOW - Gem Pack", price: 12, format: "AUCTION", orderId: "12" }),
      S({ title: "FREE PACK #3", price: 0, format: "GIVEAWAY", giveaway: true, orderId: "13" }),
      S({ title: "UPGRADED SHIPPING - INCLUDES TRACKING", price: 1, format: "BUY_IT_NOW", orderId: "14" }),
    ]);
    assert.equal(guessed, false);
    assert.deepEqual(rows.map((r) => [r.orderId, r.units, r.price]), [["11", 5, 79]]);
  });
  it("guesses from the title on a per-show export, which has no format column", () => {
    const { rows, guessed } = storeRows([
      S({ title: "5x Silver Tempest Booster Pack", price: 109 }),
      S({ title: "5x Obsidian Flames Packs - Ripped Live", price: 79 }),
      S({ title: "BANGERS ALL NIGHT!! - Gem Pack", price: 12 }),
      S({ title: "MUST BOOKMARK ALL STREAMS - FREE PACK", price: 0 }),
    ]);
    assert.equal(guessed, true);
    assert.deepEqual(rows.map((r) => r.units), [5, 5]);
  });
  it("picks the show whose title matches the stream name", () => {
    const shows = [
      { id: "a", title: "Alyssa day show", start: "2026-09-18 18:00:00", orders: 3 },
      { id: "b", title: "30TH CELEBRATION PKC ETB, 151!! W/ DESTINEE", start: "2026-09-19 01:00:00", orders: 3 },
    ];
    assert.equal(pickShow(shows, { title: "2026-09-18 - 30TH CELEBRATION PKC ETB, 151!! W/ DESTINEE", date: "2026-09-18", streamer: "Destinee" }), "b");
    assert.equal(pickShow(shows, { title: "2026-09-18 - Something else", date: "2026-09-18", streamer: "Alyssa" }), "a");
  });
});
