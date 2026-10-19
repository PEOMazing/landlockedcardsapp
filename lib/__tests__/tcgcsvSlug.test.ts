import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { slugGroups } from "../tcgcsvCards";
import { tcgSlugFromUrl } from "../slabIntake";

// si-v2. Pasting a TCGplayer link used to resolve only if the card happened
// to be in one of the newest sixteen English sets. Everything else - every
// Japanese card, every vintage English card - came back "no card found" while
// sitting perfectly intact in the mirror. These tests pin the slug reader and
// the group picker that replaced the guesswork.
//
// Group names below are the real tcgcsv spellings.
const GROUPS = [
  { groupId: 1, categoryId: 3, name: "Base Set" },
  { groupId: 2, categoryId: 3, name: "Base Set 2" },
  { groupId: 3, categoryId: 3, name: "Team Rocket" },
  { groupId: 4, categoryId: 85, name: "Expansion Pack" },
  { groupId: 5, categoryId: 85, name: "SM12a: TAG TEAM GX: Tag All Stars" },
  { groupId: 6, categoryId: 85, name: "Team Rocket (Japanese)" },
  { groupId: 7, categoryId: 3, name: "SV: Scarlet & Violet 151" },
];

describe("reading the slug off a pasted product link", () => {
  it("takes the slug from a full product URL", () => {
    assert.equal(
      tcgSlugFromUrl("https://www.tcgplayer.com/product/575602/pokemon-japan-expansion-pack-blastoise?page=1&Language=all"),
      "pokemon-japan-expansion-pack-blastoise",
    );
  });

  it("is empty for a bare id, which means no hint rather than an error", () => {
    assert.equal(tcgSlugFromUrl("575602"), "");
  });

  it("is empty for a link with no slug", () => {
    assert.equal(tcgSlugFromUrl("https://www.tcgplayer.com/product/575602"), "");
  });

  it("lowercases, because TCGplayer sometimes hands back mixed case", () => {
    assert.equal(
      tcgSlugFromUrl("https://www.tcgplayer.com/product/1/Pokemon-Base-Set-Charizard"),
      "pokemon-base-set-charizard",
    );
  });
});

describe("picking the set a pasted slug belongs to", () => {
  it("finds a Japanese set from the pokemon-japan prefix", () => {
    const hit = slugGroups(GROUPS, "pokemon-japan-expansion-pack-blastoise");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].groupId, 4);
  });

  it("will not cross catalogs: a Japanese slug never returns the English set of the same name", () => {
    const hit = slugGroups(GROUPS, "pokemon-japan-team-rocket-japanese-dark-blastoise");
    assert.deepEqual(hit.map((g) => g.groupId), [6]);
  });

  it("prefers the longer set name, so Base Set 2 does not resolve as Base Set", () => {
    const hit = slugGroups(GROUPS, "pokemon-base-set-2-blastoise");
    assert.equal(hit[0].groupId, 2);
  });

  it("handles the colon-and-ampersand spellings tcgcsv uses", () => {
    const hit = slugGroups(GROUPS, "pokemon-sv-scarlet-and-violet-151-charizard-ex-199-165");
    assert.equal(hit[0].groupId, 7);
    const jp = slugGroups(GROUPS, "pokemon-japan-sm12a-tag-team-gx-tag-all-stars-weavile-gx-216-173");
    assert.equal(jp[0].groupId, 5);
  });

  it("returns nothing for an empty slug rather than every group", () => {
    assert.deepEqual(slugGroups(GROUPS, ""), []);
  });

  it("returns nothing when the set name is not one we hold", () => {
    assert.deepEqual(slugGroups(GROUPS, "pokemon-japan-some-set-we-do-not-have-pikachu"), []);
  });

  it("does not match a set name that only happens to start the same way", () => {
    assert.deepEqual(slugGroups(GROUPS, "pokemon-base-setting-the-stage"), []);
  });
});
