import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageMismatch, imageProductId } from "../cardImage";

describe("imageProductId", () => {
  it("reads the product out of every url shape we have written", () => {
    assert.equal(imageProductId("https://tcgplayer-cdn.tcgplayer.com/product/90738_400w.jpg"), 90738);
    assert.equal(imageProductId("https://tcgplayer-cdn.tcgplayer.com/product/575743_in_200x200.jpg"), 575743);
    assert.equal(imageProductId("https://product-images.tcgplayer.com/fit-in/437x437/84613.jpg"), 84613);
  });

  it("is not fooled by a numeric directory segment", () => {
    // 437x437 is a sizing folder, not the product
    assert.equal(imageProductId("https://product-images.tcgplayer.com/fit-in/437x437/90738.jpg"), 90738);
  });

  it("gives up rather than guessing", () => {
    assert.equal(imageProductId(""), null);
    assert.equal(imageProductId("   "), null);
    assert.equal(imageProductId("not a url"), null);
    assert.equal(imageProductId("https://tcgplayer-cdn.tcgplayer.com/product/"), null);
    assert.equal(imageProductId("https://tcgplayer-cdn.tcgplayer.com/product/abc_400w.jpg"), null);
  });

  it("ignores images hosted anywhere else, because a human put those there", () => {
    assert.equal(imageProductId("https://i.imgur.com/90738.jpg"), null);
    assert.equal(imageProductId("https://example.com/product/90738_400w.jpg"), null);
  });
});

describe("imageMismatch", () => {
  const good = "https://tcgplayer-cdn.tcgplayer.com/product/575743_400w.jpg";
  const wrong = "https://tcgplayer-cdn.tcgplayer.com/product/84613_400w.jpg";

  it("catches the Dark Blastoise case: art from a different product", () => {
    // Card ID says 575743 (Dark Blastoise), art was 84613 (Dark Hypno)
    assert.equal(imageMismatch(wrong, "tcg:575743:23724:holofoil"), true);
  });

  it("passes art that matches the link", () => {
    assert.equal(imageMismatch(good, "tcg:575743:23724:holofoil"), false);
    // sizing variants of the same product are still the same product
    assert.equal(
      imageMismatch("https://tcgplayer-cdn.tcgplayer.com/product/575743_in_200x200.jpg", "tcg:575743:23724"),
      false,
    );
  });

  it("stays silent when it cannot prove anything", () => {
    // no art yet - that is the fill pass's job, not repair's
    assert.equal(imageMismatch("", "tcg:575743:23724"), false);
    // no link to check against
    assert.equal(imageMismatch(wrong, ""), false);
    assert.equal(imageMismatch(wrong, "garbage"), false);
    // hand-uploaded art is never overwritten
    assert.equal(imageMismatch("https://i.imgur.com/abc.jpg", "tcg:575743:23724"), false);
  });

  it("compares the product only, ignoring group and subtype", () => {
    // same product, different printing suffix - not a mismatch
    assert.equal(imageMismatch(good, "tcg:575743:23724:reverse-holofoil"), false);
    // old two-part id still parses
    assert.equal(imageMismatch(good, "tcg:575743:23724"), false);
  });
});
