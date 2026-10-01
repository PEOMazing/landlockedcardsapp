import { test } from "node:test";
import assert from "node:assert/strict";
import { isStreamPath, STREAM_PATHS } from "../appMode";

// The point of these is the boundary, not the happy path. The dangerous
// mistake is a prefix match that takes a page with it: /admin is the Pay page
// and must go, /admin/inventory sits under the same word and must stay.

test("the bare /admin Pay page is stream-only", () => {
  assert.equal(isStreamPath("/admin"), true);
});

test("pages a vendor needs survive, even under /admin", () => {
  for (const p of ["/admin/inventory", "/admin/settings", "/singles", "/singles/movers", "/graded", "/show", "/sets", "/quote", "/collection", "/label/rec123", "/share/singles"]) {
    assert.equal(isStreamPath(p), false, p);
  }
});

test("the streaming half is caught, pages and api alike", () => {
  for (const p of ["/dashboard", "/streams/rec123", "/streams/rec123/live", "/overlay/abc", "/vendor", "/admin/streams", "/admin/payroll", "/admin/analytics", "/admin/insights", "/admin/audit", "/api/streams/rec1/rollover", "/api/lines/bulk", "/api/payroll/paid", "/api/time"]) {
    assert.equal(isStreamPath(p), true, p);
  }
});

test("a prefix that only looks like one does not match", () => {
  // /streamers is people, not shows, and /dashboards is nothing - neither
  // should be swept up by a sloppy startsWith on /streams or /dashboard.
  assert.equal(isStreamPath("/api/streamers"), false);
  assert.equal(isStreamPath("/dashboards"), false);
  assert.equal(isStreamPath("/streamsomething"), false);
});

test("every listed path matches itself", () => {
  for (const p of STREAM_PATHS) assert.equal(isStreamPath(p), true, p);
});

test("junk in, false out", () => {
  assert.equal(isStreamPath(""), false);
  assert.equal(isStreamPath(undefined as unknown as string), false);
});
