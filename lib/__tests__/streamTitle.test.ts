import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STREAM_TITLE_MAX, streamTitleError, stripLegacyDate } from "../streamTitle";

// st-v1. Fifty characters on the stored title, date stamp included.
const AT_LIMIT = "2026-10-20 - INSANE MONDAY WHEEL WITH ALYSSA!!!!!!";
const REAL_PASTE =
  "2026-10-12 - PRISMATIC SPC, CGC 10 SLABS, OUT OF PRINT ETB AND MORE!!! L8 NITE W/Destinee";

describe("the stream title limit", () => {
  it("is fifty characters", () => {
    assert.equal(STREAM_TITLE_MAX, 50);
  });

  it("accepts a title exactly on the limit", () => {
    assert.equal(AT_LIMIT.length, 50);
    assert.equal(streamTitleError(AT_LIMIT), null);
  });

  it("rejects one character over, and says how many to cut", () => {
    const err = streamTitleError(`${AT_LIMIT}!`);
    assert.ok(err);
    assert.match(err!, /51 characters/);
    assert.match(err!, /trim 1/);
  });

  it("rejects the kind of title that actually gets pasted off Whatnot", () => {
    const err = streamTitleError(REAL_PASTE);
    assert.ok(err);
    assert.match(err!, new RegExp(`${REAL_PASTE.length - 50}`));
  });

  it("rejects an empty or whitespace title", () => {
    assert.equal(streamTitleError(""), "title cannot be empty");
    assert.equal(streamTitleError("   "), "title cannot be empty");
  });

  it("measures the trimmed title, so trailing spaces do not count against you", () => {
    assert.equal(streamTitleError(`${AT_LIMIT}     `), null);
  });

  it("never truncates - it only ever reports", () => {
    // The function returns a message or null. There is no path that quietly
    // hands back a shortened title, which is the whole point of the design.
    assert.equal(typeof streamTitleError(REAL_PASTE), "string");
    assert.equal(streamTitleError("short one"), null);
  });
});

describe("the date stamp older titles carry", () => {
  // st-v2. New titles have no stamp. These cover the ones that already do.
  it("comes off for display", () => {
    assert.equal(
      stripLegacyDate("2026-10-12 - INSANE MONDAY WHEEL WITH ALYSSA!!"),
      "INSANE MONDAY WHEEL WITH ALYSSA!!",
    );
  });

  it("tolerates the spacing variants that are actually in the table", () => {
    assert.equal(stripLegacyDate("2026-10-12 -  Spaced out"), "Spaced out");
    assert.equal(stripLegacyDate("2026-10-12-Tight"), "Tight");
  });

  it("leaves a title alone when there is no stamp", () => {
    assert.equal(stripLegacyDate("WHATNOTS CRAZIEST SLAB HUNT"), "WHATNOTS CRAZIEST SLAB HUNT");
  });

  it("does not eat a date that is part of the name rather than a prefix", () => {
    assert.equal(stripLegacyDate("Rips from 2026-10-12"), "Rips from 2026-10-12");
  });

  it("is safe on an empty title", () => {
    assert.equal(stripLegacyDate(""), "");
  });

  it("a new title now gets the whole fifty, no stamp taking thirteen of them", () => {
    const typed = "x".repeat(STREAM_TITLE_MAX);
    assert.equal(streamTitleError(typed), null);
  });
});
