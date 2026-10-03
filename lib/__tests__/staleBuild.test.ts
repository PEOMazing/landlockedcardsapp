import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isOwnAssetUrl, isStaleBuildError, nextReloadState } from "../staleBuild";

// These tests exist because the failure they guard against already happened in
// production, on a phone, during a live show, and the screen said nothing a
// person could act on. The messages asserted below are real browser strings.

describe("recognising a stale build", () => {
  it("catches the webpack chunk failure Chrome and Firefox report", () => {
    assert.equal(isStaleBuildError(new Error("Loading chunk 2117 failed.")), true);
    assert.equal(isStaleBuildError(new Error("Loading chunk app/layout failed.")), true);
    assert.equal(isStaleBuildError(new Error("Loading CSS chunk 441 failed")), true);
  });

  it("catches a ChunkLoadError by name even when the message is empty", () => {
    const e = new Error("");
    e.name = "ChunkLoadError";
    assert.equal(isStaleBuildError(e), true);
  });

  it("catches native dynamic import failures in both Chrome and Safari wording", () => {
    assert.equal(
      isStaleBuildError(new Error("Failed to fetch dynamically imported module: https://x/_next/a.js")),
      true,
    );
    assert.equal(isStaleBuildError(new Error("Importing a module script failed.")), true);
  });

  it("takes a bare string, because window.onerror hands over a string", () => {
    assert.equal(isStaleBuildError("Uncaught ChunkLoadError"), true);
    assert.equal(isStaleBuildError("TypeError: x is not a function"), false);
  });

  it("does not fire on ordinary application errors", () => {
    // The whole value of this guard is that it reloads for one specific cause.
    // If it reloaded on any error, a real bug would become an invisible
    // reload loop and the bug would never get reported.
    assert.equal(isStaleBuildError(new Error("Cannot read properties of undefined")), false);
    assert.equal(isStaleBuildError(new TypeError("qty is not iterable")), false);
    assert.equal(isStaleBuildError(new Error("Airtable 422: INVALID_VALUE_FOR_COLUMN")), false);
    assert.equal(isStaleBuildError(null), false);
    assert.equal(isStaleBuildError(undefined), false);
    assert.equal(isStaleBuildError({}), false);
  });
});

describe("only our own build assets count", () => {
  it("matches this build's static files", () => {
    assert.equal(isOwnAssetUrl("https://www.landlockedcards.app/_next/static/chunks/webpack-ef9e45ee.js"), true);
    assert.equal(isOwnAssetUrl("/_next/static/css/abc123.css"), true);
  });

  it("ignores third parties, because reloading does not fix their outage", () => {
    assert.equal(isOwnAssetUrl("https://clerk.landlockedcards.app/npm/@clerk/clerk-js.js"), false);
    assert.equal(isOwnAssetUrl("https://fonts.googleapis.com/css2?family=Inter"), false);
    assert.equal(isOwnAssetUrl("https://product-images.tcgplayer.com/1.jpg"), false);
    assert.equal(isOwnAssetUrl(null), false);
    assert.equal(isOwnAssetUrl(""), false);
  });
});

describe("the reload budget", () => {
  const T = 1_700_000_000_000;

  it("reloads on a first hit in a fresh tab", () => {
    const r = nextReloadState(null, T);
    assert.equal(r.reload, true);
    assert.equal(r.store, `${T}:1`);
  });

  it("allows a second reload, since the first can land mid-deploy", () => {
    const r = nextReloadState(`${T}:1`, T + 2_000);
    assert.equal(r.reload, true);
    assert.equal(r.store, `${T}:2`);
  });

  it("stops at two inside the window instead of looping forever", () => {
    // A reload loop is worse than the error screen: the page flashes and
    // nobody can read what went wrong or press anything.
    const r = nextReloadState(`${T}:2`, T + 3_000);
    assert.equal(r.reload, false);
  });

  it("forgives the budget once the window has passed", () => {
    // A streamer who hits this at 7pm and again at 11pm is two separate
    // deploys, not a loop.
    const r = nextReloadState(`${T}:2`, T + 61_000);
    assert.equal(r.reload, true);
    assert.equal(r.store, `${T + 61_000}:1`);
  });

  it("treats a corrupted stored value as a fresh start rather than throwing", () => {
    for (const junk of ["", "garbage", "abc:def", ":", "123"]) {
      const r = nextReloadState(junk, T);
      assert.equal(r.reload, true, `junk value ${JSON.stringify(junk)} should not block recovery`);
    }
  });
});
